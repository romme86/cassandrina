const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function getBasePath(): string {
  if (!rawBasePath || rawBasePath === "/") {
    return "";
  }

  const normalized = rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function withBasePath(path: string): string {
  if (!path) {
    return getBasePath() || "/";
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const basePath = getBasePath();

  if (!basePath || normalizedPath === basePath || normalizedPath.startsWith(`${basePath}/`)) {
    return normalizedPath;
  }

  return `${basePath}${normalizedPath}`;
}
