# Court Scout iOS

`CourtScoutModels` is a Swift package with `Codable` types for the canonical
dataset in `contracts/team-data.schema.json` (contract `2.0.0`). It is the
first piece of Phase 2 in `requirements/ios-app-plan.md`.

## Regenerating

`TeamData.generated.swift` is generated. After changing the schema, run:

```bash
npm run generate:swift
```

`npm test` fails when the checked-in Swift file is out of date.

## Testing

```bash
swift test --package-path ios/CourtScoutModels
```

This needs a full Xcode install; the Command Line Tools alone do not ship a
usable Swift Testing module. The tests decode every checked-in `data/collections/**/team-data.json` and
check that encoding it again gives the same JSON.

## Mapping rules

- Schema objects become structs. Objects nested inside a property become
  nested types, such as `RosterPlayer.UTR` and `Match.TeamResult`.
- Values that are nullable or not required become optionals. Encoding keeps
  `null` versus absent: required nullable keys always encode `null`, and
  optional nullable keys encode `null` only if they were `null` when decoded.
- String enums become open `RawRepresentable` structs. Values the app does not
  know yet still decode, and `knownValues` lists the values from the schema.
- Objects that allow extra keys keep them in `additionalProperties`, so the
  app can save a dataset again without losing fields the schema does not
  declare.
- Objects without declared properties, such as `dataQuality`, are `JSONValue`.
- Dates and date-times stay as `String`, the same as in the JSON. Parse them
  where they are displayed.
