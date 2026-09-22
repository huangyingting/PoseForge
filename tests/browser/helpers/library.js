/** Follow the same disclosure path as a user; never mutate hidden controls. */
export async function openLibraryFilters(page) {
  const button = page.getByRole("button", { name: /^Filters(?: \(\d+\))?$/ });
  if ((await button.getAttribute("aria-expanded")) !== "true")
    await button.click();
}
