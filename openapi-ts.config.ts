// noinspection JSUnusedGlobalSymbols

import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "https://www.handyfeeling.com/api/handy-rest/v3/docs/spec.yaml",
  output: {
    path: "src/utils/apis/thehandy",
  },
  plugins: [
    "zod",
    {
      name: "@hey-api/sdk",
      validator: true,
    },
  ],
});
