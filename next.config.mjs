/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  // Garante a inclusão da política no bundle do Route Handler em deploys standalone.
  outputFileTracingIncludes: {
    "/api/verify": ["./docs/POLITICA_DE_VERIFICACAO.md"],
  },
};
