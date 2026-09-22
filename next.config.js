/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: __dirname },
  reactStrictMode: true,
  allowedDevOrigins: ["*.ngrok-free.app", "*.ngrok.io", "*.loca.lt"],
  // Next 16 otherwise writes AGENTS.md and CLAUDE.md into the repo root on
  // every `next dev` start.
  agentRules: false,
};

module.exports = nextConfig;
