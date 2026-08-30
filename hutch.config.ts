// Hutch project tasks. Hutch owns install/dev/build; the renderer is built
// with Vite (see vite.config.ts) through an explicit task.
export default {
  scripts: {
    install: ["hutch", "install"],
    "build:view": ["hutch", "electrobun", "prepare", "&&", "hutch", "pm", "exec", "--", "vite", "build"],
    dev: ["hutch", "electrobun", "dev", "--watch"],
    build: ["hutch", "electrobun", "build", "--env=stable"],
  },
};
