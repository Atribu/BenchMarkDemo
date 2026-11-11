const BASE_PATH = "/benchmark";

export function withBasePath(path: string) {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}
