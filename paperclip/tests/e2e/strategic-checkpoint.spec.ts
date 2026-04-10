import { expect, test } from "@playwright/test";

test.describe("Strategic checkpoint selectors", () => {
  test("persist project mode and send issue override payload", async ({ page }) => {
    const stamp = Date.now();
    const companyName = `E2E-Checkpoint-${stamp}`;
    const projectName = `E2E-Project-${stamp}`;

    await page.goto("/");

    const companyRes = await page.request.post("/api/companies", {
      data: { name: companyName },
    });
    expect(companyRes.ok()).toBe(true);
    const company = await companyRes.json();
    const companyPrefix = String(company.issuePrefix ?? "").toUpperCase();

    const projectRes = await page.request.post(`/api/companies/${company.id}/projects`, {
      data: { name: projectName, status: "planned" },
    });
    expect(projectRes.ok()).toBe(true);
    const project = await projectRes.json();

    await page.goto(`/${companyPrefix}/projects/${project.id}/configuration`);
    await expect(page.getByTestId("project-strategic-checkpoint-mode")).toBeVisible({ timeout: 20_000 });

    const projectPatchReqPromise = page.waitForRequest(
      (request) =>
        request.method() === "PATCH"
        && request.url().includes(`/api/projects/${project.id}`)
        && request.postData()?.includes("strategicCheckpointMode"),
    );
    await page.getByTestId("project-strategic-checkpoint-mode").selectOption("qa_gate");
    const projectPatchReq = await projectPatchReqPromise;
    const projectPatchPayload = projectPatchReq.postDataJSON() as {
      executionWorkspacePolicy?: { strategicCheckpointMode?: string };
    };
    expect(projectPatchPayload.executionWorkspacePolicy?.strategicCheckpointMode).toBe("qa_gate");

    await page.reload();
    await expect(page.getByTestId("project-strategic-checkpoint-mode")).toHaveValue("qa_gate");

    await page.getByRole("button", { name: "New Issue" }).first().click();
    await expect(page.locator('textarea[placeholder="Issue title"]')).toBeVisible({ timeout: 10_000 });

    await page.locator('textarea[placeholder="Issue title"]').fill("Strategic checkpoint payload test");
    await page.getByTestId("issue-strategic-checkpoint-mode").selectOption("manual_gate");

    const issueCreateReqPromise = page.waitForRequest(
      (request) =>
        request.method() === "POST"
        && request.url().includes(`/api/companies/${company.id}/issues`),
    );
    await page.getByRole("button", { name: "Create Issue" }).click();
    const issueCreateReq = await issueCreateReqPromise;
    const issueCreatePayload = issueCreateReq.postDataJSON() as {
      strategicCheckpoint?: { mode?: string };
    };
    expect(issueCreatePayload.strategicCheckpoint?.mode).toBe("manual_gate");
  });
});
