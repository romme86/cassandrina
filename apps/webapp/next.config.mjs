const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const normalizedBasePath =
  rawBasePath && rawBasePath !== "/"
    ? `${rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`}`.replace(/\/$/, "")
    : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@cassandrina/shared"],
  basePath: normalizedBasePath || undefined,
};

export default nextConfig;
