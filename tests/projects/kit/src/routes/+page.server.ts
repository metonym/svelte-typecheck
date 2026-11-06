export const actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    return { ok: form.has("x") };
  },
};
