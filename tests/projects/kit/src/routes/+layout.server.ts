export function load({ cookies }) {
  return { user: cookies.get("user") ?? "anon" };
}
