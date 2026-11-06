export const load = async ({ params, fetch }) => {
  const posts: string[] = [];
  const bad: number = params;
  return { posts, bad, f: typeof fetch };
};
export const prerender = "yes";
