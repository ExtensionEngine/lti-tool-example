import { ZodError, z } from "zod";
import { generatePlatformKeyPair } from "../utils/auth";
import useRegistrationStorage from "../storage/registration";
import usePlatformStorage from "../storage/platform";

type Configuration = {
  issuer: string;
  token_endpoint: string;
  jwks_uri: string;
  authorization_endpoint: string;
  registration_endpoint: string;
  claims_supported: string[];
  "https://purl.imsglobal.org/spec/lti-platform-configuration": {
    product_family_code: string;
  };
};

const registrationContinuationQuerySchema = z.object({
  endpoint: z.string(),
  tool_name: z.string(),
});

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const { serverUrl } = useRuntimeConfig();

  let configurationEndpoint, toolName;
  try {
    ({ endpoint: configurationEndpoint, tool_name: toolName } =
      await registrationContinuationQuerySchema.parseAsync(body));
  } catch (error: any) {
    console.error("Error parsing body", error);
    if (error instanceof ZodError) {
      throw createError({ statusCode: 400, statusMessage: error.message });
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Something went wrong",
    });
  }

  const registrationStorage = useRegistrationStorage();
  const registration = await registrationStorage.getItem(configurationEndpoint);
  if (!registration)
    throw createError({
      statusCode: 400,
      statusMessage: "Registration not started",
    });

  await registrationStorage.removeItem(configurationEndpoint);

  const configuration: Configuration = await $fetch(configurationEndpoint);
  const scope = [
    "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
    "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
    "https://purl.imsglobal.org/spec/lti-ags/scope/score",
    "https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly",
    "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly",
  ];
  const launchUrl = new URL("launch", serverUrl);
  const deepLinkUrl = new URL("deep-link-launch", serverUrl);
  const loginUrl = new URL("login", serverUrl);
  const keysUrl = new URL("keys", serverUrl);
  const registrationRequest = {
    application_type: "web",
    grant_types: ["implicit", "client_credentials"],
    response_types: ["id_token"],
    redirect_uris: [launchUrl.href, deepLinkUrl.href],
    initiate_login_uri: loginUrl.href,
    client_name: "Nuxt LTI Tool",
    jwks_uri: keysUrl.href,
    logo_uri: "https://nuxtjs.ir/logos/nuxt-icon-white.png",
    token_endpoint_auth_method: "private_key_jwt",
    scope: scope.join(" "),
    "https://purl.imsglobal.org/spec/lti-tool-configuration": {
      domain: serverUrl,
      description: "Example Nuxt LTI Tool for testing purposes",
      target_link_uri: launchUrl.href,
      custom_parameters: {},
      claims: configuration.claims_supported,
      messages: [
        { type: "LtiResourceLinkRequest" },
        {
          type: "LtiDeepLinkingRequest",
          target_link_uri: deepLinkUrl.href,
        },
      ],
    },
  };

  const { client_id: clientId }: { client_id: string } = await $fetch(
    configuration.registration_endpoint,
    {
      method: "POST",
      body: registrationRequest,
      headers: {
        Authorization: `Bearer ${registration.token}`,
      },
    }
  );

  const storage = usePlatformStorage();
  const platformName =
    configuration["https://purl.imsglobal.org/spec/lti-platform-configuration"]
      .product_family_code;

  const kid = await generatePlatformKeyPair();
  const platform = {
    url: configuration.issuer,
    name: platformName,
    clientId,
    authenticationEndpoint: configuration.authorization_endpoint,
    accesstokenEndpoint: configuration.token_endpoint,
    authConfig: {
      method: "JWK_SET",
      key: configuration.jwks_uri,
    },
    kid,
    toolName,
  };

  if (await storage.hasItem(`${platform.url}:${platform.clientId}`)) {
    throw createError({
      statusCode: 409,
      statusMessage: "Platform already registered",
    });
  }

  console.info("New platform registered: ", platform);
  await storage.setItem(`${platform.url}:${platform.clientId}`, platform);

  appendResponseHeaders(event, {
    "content-type": "text/html",
  });
  return '<script>(window.opener || window.parent).postMessage({subject:"org.imsglobal.lti.close"}, "*");</script>';
});
