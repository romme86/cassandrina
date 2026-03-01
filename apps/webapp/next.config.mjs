/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@cassandrina/shared"],
};

export default nextConfig;
