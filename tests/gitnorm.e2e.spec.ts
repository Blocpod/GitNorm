import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function addVirtualPasskey(context: BrowserContext, page: Page) {
  const client = await context.newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function register(page: Page, displayName: string, handle: string) {
  await page.getByRole("textbox", { name: "Your name" }).fill(displayName);
  await page.getByRole("textbox", { name: /Your public handle/ }).fill(handle);
  await page.getByRole("button", { name: "Create my account →" }).click();
  await expect(
    page.getByRole("heading", {
      name: new RegExp(`Good afternoon, ${displayName.split(" ")[0]}`),
    }),
  ).toBeVisible();
}

test("standalone passkey accounts preserve private work and revoke public links", async ({
  browser,
}) => {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const ownerHandle = `owner${suffix}`.slice(0, 30);
  const otherHandle = `other${suffix}`.slice(0, 30);
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto("/");
  await addVirtualPasskey(ownerContext, owner);
  await register(owner, "Owner Maker", ownerHandle);

  await owner.getByRole("button", { name: "Add your first project →" }).click();
  const chooserPromise = owner.waitForEvent("filechooser");
  await owner.getByRole("button", { name: "Choose .zip" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles("test-fixtures/weekend-picker.zip");
  await expect(owner.getByText(/left out 1 sensitive/)).toBeVisible();
  await expect(owner.getByLabel("Files ready to upload")).not.toContainText(
    ".env",
  );
  await owner.getByRole("button", { name: "Save project" }).click();
  await expect(
    owner.getByRole("heading", { name: "weekend-picker" }),
  ).toBeVisible();

  const detail = (await owner.evaluate(async () => {
    const projects = (await (await fetch("/api/projects")).json()) as {
      projects: Array<{ id: string }>;
    };
    const project = projects.projects[0];
    return await (await fetch(`/api/projects/${project.id}`)).json();
  })) as {
    project: { id: string; slug: string };
    files: Array<{ id: string }>;
    versions: Array<{ id: string }>;
  };
  const projectId = detail.project.id;
  const slug = detail.project.slug;
  const fileId = detail.files[0].id;
  const sourceVersionId = detail.versions[0].id;

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.goto("/");
  await addVirtualPasskey(otherContext, other);
  await register(other, "Other Maker", otherHandle);
  const isolation = await other.evaluate(
    async ({ projectId, fileId, sourceVersionId }) => {
      const requests: Record<string, Promise<Response>> = {
        detail: fetch(`/api/projects/${projectId}`),
        download: fetch(`/api/projects/${projectId}/download`),
        file: fetch(`/api/files/${fileId}`),
        patch: fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "stolen" }),
        }),
        delete: fetch(`/api/projects/${projectId}`, { method: "DELETE" }),
        restore: fetch(`/api/projects/${projectId}/versions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restoreVersionId: sourceVersionId }),
        }),
      };
      return Object.fromEntries(
        await Promise.all(
          Object.entries(requests).map(async ([name, request]) => [
            name,
            (await request).status,
          ]),
        ),
      );
    },
    { projectId, fileId, sourceVersionId },
  );
  expect(isolation).toEqual({
    detail: 404,
    download: 404,
    file: 404,
    patch: 404,
    delete: 404,
    restore: 404,
  });

  const published = await owner.evaluate(
    async (projectId) =>
      (
        await fetch(`/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visibility: "public" }),
        })
      ).status,
    projectId,
  );
  expect(published).toBe(200);
  const anonymousContext = await browser.newContext();
  const anonymous = await anonymousContext.newPage();
  await expect((await anonymous.request.get(`/s/${slug}`)).status()).toBe(200);
  await expect((await anonymous.request.get(`/discover`)).status()).toBe(200);
  await expect(
    (await anonymous.request.get(`/creator/${ownerHandle}`)).status(),
  ).toBe(200);
  await expect(
    (
      await anonymous.request.get(
        `/api/projects/${projectId}/download?share=${slug}`,
      )
    ).status(),
  ).toBe(200);
  await expect(
    (await anonymous.request.get(`/api/files/${fileId}`)).status(),
  ).toBe(200);

  await owner.evaluate(
    async (projectId) =>
      fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: "private" }),
      }),
    projectId,
  );
  await expect((await anonymous.request.get(`/s/${slug}`)).status()).toBe(404);
  await expect(
    (
      await anonymous.request.get(
        `/api/projects/${projectId}/download?share=${slug}`,
      )
    ).status(),
  ).toBe(404);
  await expect(
    (await anonymous.request.get(`/api/files/${fileId}`)).status(),
  ).toBe(404);

  const races = await owner.evaluate(
    async ({ projectId, sourceVersionId }) =>
      Promise.all(
        Array.from(
          { length: 20 },
          async () =>
            (
              await fetch(`/api/projects/${projectId}/versions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ restoreVersionId: sourceVersionId }),
              })
            ).status,
        ),
      ),
    { projectId, sourceVersionId },
  );
  expect(races).toEqual(Array(20).fill(200));
  const numbers = await owner.evaluate(async (projectId) => {
    const data = (await (await fetch(`/api/projects/${projectId}`)).json()) as {
      versions: Array<{ number: number }>;
    };
    return data.versions.map((version) => version.number);
  }, projectId);
  expect(new Set(numbers).size).toBe(numbers.length);
  expect(Math.max(...numbers) - Math.min(...numbers) + 1).toBe(numbers.length);

  await owner.getByRole("button", { name: "Open profile" }).click();
  await owner.getByRole("button", { name: "Sign out" }).click();
  await owner.getByRole("button", { name: "Sign in" }).last().click();
  await owner.getByRole("button", { name: "Sign in with a passkey →" }).click();
  await expect(
    owner.getByRole("heading", { name: /Good afternoon, Owner/ }),
  ).toBeVisible();

  expect(
    await owner.evaluate(
      async (projectId) =>
        (await fetch(`/api/projects/${projectId}`, { method: "DELETE" }))
          .status,
      projectId,
    ),
  ).toBe(200);
  expect(
    await owner.evaluate(
      async (fileId) => (await fetch(`/api/files/${fileId}`)).status,
      fileId,
    ),
  ).toBe(404);
  await owner.evaluate(async () => fetch("/api/profile", { method: "DELETE" }));
  await other.evaluate(async () => fetch("/api/profile", { method: "DELETE" }));
  await expect((await owner.request.get("/api/auth/session")).status()).toBe(
    401,
  );

  await anonymousContext.close();
  await otherContext.close();
  await ownerContext.close();
});
