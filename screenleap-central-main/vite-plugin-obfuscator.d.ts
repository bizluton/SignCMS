declare module "vite-plugin-obfuscator" {
  import type { Plugin } from "vite";
  interface ObfuscatorOptions {
    options?: Record<string, unknown>;
  }
  export function viteObfuscateFile(opts?: ObfuscatorOptions): Plugin;
}
