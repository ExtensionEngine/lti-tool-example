import { Registration } from "../types/registration";

export default function useRegistrationStorage() {
  return useStorage<Registration>("registration");
}
