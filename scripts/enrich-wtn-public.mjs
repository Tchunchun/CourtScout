#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, requireArg } from "./lib/cli.mjs";
import { readJson, sleep, writeJsonAtomic } from "./lib/io.mjs";
import {
  identityGender,
  ratingPeople,
  ratingScopeIncludes
} from "./lib/ratings.mjs";
import { updateCourtJoins } from "./lib/utr.mjs";
import {
  chooseWtnCandidate,
  mapWtnCandidates,
  resolvedWtn,
  unresolvedWtn
} from "./lib/wtn.mjs";

const ENDPOINT = "https://prd-itf-kube.clubspark.pro/graphql";
const usage = `Usage:
  node scripts/enrich-wtn-public.mjs --input <team-data.json> [--delay-ms 300]
    [--scope all|team|opponents]`;
const query = `
  query getPlayers($filter: PublicPersonFilterOptions, $pageArgs: PaginationArgs) {
    publicPersons(filter: $filter, pageArgs: $pageArgs) {
      items {
        id
        tennisID
        nativeGivenName
        nativeFamilyName
        nationalityCode
        sex
        age
        birthYear
        worldTennisNumbers {
          type
          tennisNumber
          confidence
        }
        addresses {
          addressType
          city
          countryCode
          state
        }
      }
      totalItems
    }
  }
`;

export async function searchWtnProfiles(name, fetchImpl = fetch) {
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      query,
      variables: {
        filter: { search: { term: name } },
        pageArgs: { limit: 50, skip: 0 }
      }
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) {
    throw new Error(`WTN public search failed with HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error(`WTN public search failed: ${payload.errors[0].message}`);
  }
  return mapWtnCandidates(payload);
}

export async function enrichPublicWtn(inputPath, options = {}) {
  const delayMs = options.delayMs ?? 300;
  const fetchImpl = options.fetchImpl ?? fetch;
  const dataset = await readJson(inputPath);
  const scope = options.scope ?? "all";
  const people = ratingPeople(dataset, scope);

  for (const person of people) {
    const candidates = await searchWtnProfiles(person.name, fetchImpl);
    const selection = chooseWtnCandidate(
      person.name,
      person.locations,
      candidates,
      identityGender(person.player.gender, dataset.team.gender)
    );
    person.player.wtn = selection.candidate
      ? resolvedWtn(selection.candidate)
      : unresolvedWtn(selection);
    updateCourtJoins(dataset);
    await writeJsonAtomic(inputPath, dataset);
    console.log(`${person.kind}: ${person.name} -> WTN ${person.player.wtn.lookupStatus}`);
    await sleep(delayMs);
  }

  dataset.generatedAt = new Date().toISOString();
  dataset.sources = dataset.sources.filter(source =>
    source.type !== "world_tennis_number_public_profiles"
  );
  dataset.sources.push({
    type: "world_tennis_number_public_profiles",
    url: ENDPOINT,
    retrievedAt: new Date().toISOString().slice(0, 10),
    authentication: "not_authenticated",
    fields: [
      "profile identity",
      "location and nationality",
      "singles WTN",
      "doubles WTN",
      "rating confidence"
    ],
    limitation: "Public search results are matched conservatively by exact name, gender, and location."
  });
  dataset.dataQuality.unresolvedWtnIdentities = [
    ...(dataset.dataQuality.unresolvedWtnIdentities ?? []).filter(item =>
      !ratingScopeIncludes(scope, item.kind ?? "roster")
    ),
    ...people
      .filter(person => person.player.wtn.lookupStatus !== "public_profile_resolved")
      .map(person => ({
        name: person.name,
        kind: person.kind,
        status: person.player.wtn.lookupStatus
      }))
  ];
  updateCourtJoins(dataset);
  await writeJsonAtomic(inputPath, dataset);
  console.log(`Enriched ${people.length} records with public WTN data`);
  return dataset;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const inputPath = resolve(requireArg(args, "input", usage));
    const delayMs = Number(args["delay-ms"] ?? 300);
    await enrichPublicWtn(inputPath, { delayMs, scope: args.scope });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
