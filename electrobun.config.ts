import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Subtitle Tool",
    identifier: "dev.bundev.subtitle-tool",
    version: "0.1.0",
  },
  build: {
    mainProcess: "cottontail",
    cottontail: {
      entrypoint: "src/bun/index.ts",
    },
    copy: {
      "dist/mainview": "views/mainview",
    },
  },
} satisfies ElectrobunConfig;
