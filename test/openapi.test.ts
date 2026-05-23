import { describe, expect, it } from "vitest";
import { findOpenApiAction, listOpenApiActions } from "../src/leadtime-client.js";

describe("OpenAPI action helpers", () => {
  const doc = {
    paths: {
      "/tasks/{identifier}": {
        get: { operationId: "TasksController_getTaskDetails", summary: "Get task" },
        patch: { summary: "Update task" },
      },
    },
  };

  it("lists and resolves operations", () => {
    const actions = listOpenApiActions(doc);
    expect(actions.map((action) => action.method)).toEqual(["PATCH", "GET"]);
    expect(findOpenApiAction(doc, "TasksController_getTaskDetails")?.path).toBe("/tasks/{identifier}");
    expect(findOpenApiAction(doc, "PATCH /tasks/{identifier}")?.summary).toBe("Update task");
  });
});
