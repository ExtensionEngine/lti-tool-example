import { ZodError, z } from "zod";
import useRegistrationStorage from "../storage/registration";

const registrationQuerySchema = z.object({
  openid_configuration: z.string(),
  registration_token: z.string().optional(),
});

export default defineEventHandler(async (event) => {
  const query = getQuery(event);

  let configurationEndpoint, registrationToken;
  try {
    ({
      openid_configuration: configurationEndpoint,
      registration_token: registrationToken,
    } = await registrationQuerySchema.parseAsync(query));
  } catch (error: any) {
    console.error("Error parsing query", error);
    if (error instanceof ZodError) {
      throw createError({
        statusCode: 400,
        statusMessage: error.message,
      });
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Something went wrong",
    });
  }

  const registrationStorage = useRegistrationStorage();
  await registrationStorage.setItem(`${configurationEndpoint}`, {
    token: registrationToken || "",
  });

  appendResponseHeaders(event, {
    "content-type": "text/html",
  });
  return `
    <form id="tool-name-form" action="/continue-registration" method="post">
      <input type="hidden" name="endpoint" value="${configurationEndpoint}" />
      <label for="tool_name">Tool name</label>
      <input id="tool_name" name="tool_name" />
      <button type="submit" form="tool-name-form">Continue</button>
    </form>
  `;
});
