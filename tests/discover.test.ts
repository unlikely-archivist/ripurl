// Name gate: the domain has to belong to the dead company, not an acquirer or a namesake.
import { assert, assertEquals } from "jsr:@std/assert@1";
import { domainMatchesName, scoreCandidate } from "../val/lib/discover.ts";
import type { Candidate } from "../val/lib/types.ts";

Deno.test("domain matches the company's name", () => {
  assert(domainMatchesName("bomis.com", "Bomis"));
  assert(domainMatchesName("theglobe.com", "theglobe.com"));
  assert(domainMatchesName("legendent.com", "Legend Entertainment"));
});

Deno.test("domain matches the company's initials", () => {
  assert(domainMatchesName("iup.com", "International Universities Press"));
});

Deno.test("an acquirer's or stranger's domain does not match", () => {
  assert(!domainMatchesName("oracle.com", "JD Edwards"));
  assert(!domainMatchesName("yahoo.com", "GeoCities"));
});

Deno.test("a one-letter domain never matches", () => {
  assert(!domainMatchesName("x.com", "Xoom Corporation"));
});

Deno.test("scoring favors a well-archived, well-documented dot-com", () => {
  const base = {
    company: "Example",
    domain: "example-company-holdings.com",
    description: "manufacturer",
    dissolvedYear: new Date().getFullYear() - 20,
    extract: "short",
    monthsArchived: 1,
  } as unknown as Candidate;
  const strong = {
    ...base,
    domain: "bomis.com",
    description: "internet company and web portal",
    extract: "x".repeat(3000),
    monthsArchived: 120,
  } as Candidate;
  assert(scoreCandidate(strong) > scoreCandidate(base));
  assertEquals(scoreCandidate(strong) <= 10, true);
});
