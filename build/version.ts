import { version as packageVersion } from "../package.json";

export function getBuildVersion(): string {
  return packageVersion;
}
