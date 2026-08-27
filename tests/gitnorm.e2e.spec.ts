import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { strToU8, unzipSync, zipSync } from "fflate";
import { existsSync } from "node:fs";
import path from "node:path";

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
      name: new RegExp(
        `Look what you’ve brought to life, ${displayName.split(" ")[0]}`,
      ),
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

  await owner
    .getByRole("button", { name: "Give your first app a home →" })
    .click();
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
  const originalFileId = detail.files[0].id;
  let fileId = originalFileId;
  const sourceVersionId = detail.versions[0].id;

  const firstDownload = await owner.request.get(
    `/api/projects/${projectId}/download`,
  );
  expect(firstDownload.status()).toBe(200);
  const firstArchive = unzipSync(new Uint8Array(await firstDownload.body()));
  expect(Object.keys(firstArchive).sort()).toEqual([
    "test-fixtures/weekend-picker/README.md",
    "test-fixtures/weekend-picker/index.html",
  ]);
  expect(Object.keys(firstArchive)).not.toContain(
    "test-fixtures/weekend-picker/.env",
  );

  let updateIntentId = "";
  owner.on("response", async (response) => {
    if (
      response.request().method() === "POST" &&
      response.url().endsWith("/api/uploads/intents")
    ) {
      const data = (await response.json()) as { intentId?: string };
      updateIntentId = data.intentId || updateIntentId;
    }
  });
  await owner.getByRole("button", { name: "＋ Add an update" }).click();
  const updateChooserPromise = owner.waitForEvent("filechooser");
  await owner.getByRole("button", { name: "Choose .zip" }).click();
  const updateChooser = await updateChooserPromise;
  const updateZip = zipSync({
    "test-fixtures/weekend-picker/index.html": strToU8(
      "<main><h1>Weekend Picker v2</h1></main>",
    ),
    "test-fixtures/weekend-picker/README.md": strToU8("# Weekend Picker\n"),
    "test-fixtures/weekend-picker/app.js": strToU8("console.log('ready')"),
  });
  await updateChooser.setFiles({
    name: "weekend-picker-v2.zip",
    mimeType: "application/zip",
    buffer: Buffer.from(updateZip),
  });
  await owner.getByLabel("What changed?").fill("Added the picker logic");
  await owner.getByRole("button", { name: "Save new version" }).click();
  await expect(
    owner.getByText("1 added · 2 updated", { exact: true }),
  ).toBeVisible();
  expect(updateIntentId).toBeTruthy();
  const replayStatuses = await owner.evaluate(
    async ({ projectId, intentId }) =>
      Promise.all(
        Array.from(
          { length: 5 },
          async () =>
            (
              await fetch(`/api/projects/${projectId}/versions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ intentId, note: "Replay" }),
              })
            ).status,
        ),
      ),
    { projectId, intentId: updateIntentId },
  );
  expect(replayStatuses.every((status) => status === 400)).toBe(true);

  await owner.getByRole("button", { name: "Settings" }).click();
  await owner.getByLabel("One-line description").fill("Pick a better weekend");
  await owner
    .getByLabel("About this project")
    .fill("A tiny planner for choosing the best weekend.");
  await owner.getByRole("button", { name: "Save changes" }).click();
  await expect(owner.getByText("Pick a better weekend")).toBeVisible();

  const updatedDownload = await owner.request.get(
    `/api/projects/${projectId}/download`,
  );
  const updatedArchive = unzipSync(
    new Uint8Array(await updatedDownload.body()),
  );
  expect(Object.keys(updatedArchive).sort()).toEqual([
    "test-fixtures/weekend-picker/README.md",
    "test-fixtures/weekend-picker/app.js",
    "test-fixtures/weekend-picker/index.html",
  ]);
  expect(
    new TextDecoder().decode(
      updatedArchive["test-fixtures/weekend-picker/app.js"],
    ),
  ).toBe("console.log('ready')");
  const updatedDetail = (await owner.evaluate(
    async (projectId) => (await fetch(`/api/projects/${projectId}`)).json(),
    projectId,
  )) as {
    files: Array<{ id: string }>;
  };
  fileId = updatedDetail.files[0].id;

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
    owner.getByRole("heading", {
      name: /Look what you’ve brought to life, Owner/,
    }),
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
  const abandoned = zipSync({ "unfinished/readme.txt": strToU8("unfinished") });
  const abandonedStorageKey = await owner.evaluate(async (bytes) => {
    const intent = (await (
      await fetch("/api/uploads/intents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "create_project",
          expectedSize: bytes.length,
          filename: "unfinished.zip",
        }),
      })
    ).json()) as { intentId: string; storageKey: string };
    const upload = await fetch(`/api/uploads/local/${intent.intentId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      body: new Uint8Array(bytes),
    });
    if (!upload.ok) throw new Error("Pending upload fixture failed.");
    return intent.storageKey;
  }, Array.from(abandoned));
  await owner.evaluate(async () => fetch("/api/profile", { method: "DELETE" }));
  expect(
    existsSync(
      path.join(process.cwd(), ".gitnorm", "blobs", abandonedStorageKey),
    ),
  ).toBe(false);
  await other.evaluate(async () => fetch("/api/profile", { method: "DELETE" }));
  await expect((await owner.request.get("/api/auth/session")).status()).toBe(
    401,
  );

  await anonymousContext.close();
  await otherContext.close();
  await ownerContext.close();
});
