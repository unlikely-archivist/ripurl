// Admin endpoints take the token only from the Authorization header, never from the URL.
import { assert } from "jsr:@std/assert@1";
import { authorized } from "../val/http.ts";

const withToken = (fn: () => void) => {
  Deno.env.set("RUN_TOKEN", "s3cret");
  try {
    fn();
  } finally {
    Deno.env.delete("RUN_TOKEN");
  }
};

Deno.test("a Bearer header with the right token is authorized", () => {
  withToken(() => assert(authorized(new Request("https://x/run", { headers: { authorization: "Bearer s3cret" } }))));
});

Deno.test("the token in the URL is no longer accepted", () => {
  withToken(() => assert(!authorized(new Request("https://x/run?token=s3cret"))));
});

Deno.test("a wrong or missing token is refused", () => {
  withToken(() => {
    assert(!authorized(new Request("https://x/run", { headers: { authorization: "Bearer nope" } })));
    assert(!authorized(new Request("https://x/run")));
  });
});

Deno.test("with no RUN_TOKEN configured, nothing is authorized", () => {
  assert(!authorized(new Request("https://x/run", { headers: { authorization: "Bearer " } })));
});
