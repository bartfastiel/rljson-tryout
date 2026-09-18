Feature: Species images as blobs
  Every species has an image, a PNG rendered from the species id by the
  domain package and stored in the node's blob store under its content id,
  which the species row carries in `imageBlobId` (slice B12,
  `docs/findings/blobs.md`). A visitor sees the image on the species cards,
  as a thumbnail on the animal cards and next to the facts of an animal; a
  client fetches it once and may keep it, because the path names the
  species version by its hash and the version names the image by content.

  Scenario: The species list links every species to its image
    Given a freshly seeded pet shop store
    When the client requests the species list
    Then every listed species carries an image URL under /api/species
    And every linked image is a PNG served with an immutable cache header

  Scenario: An animal carries the image of its species version
    Given a freshly seeded pet shop store
    When the client requests the seeded animal "sir-quackington"
    Then the animal links to the image of the species "duck"

  Scenario: Seeding stores every species image exactly once
    Given a freshly seeded pet shop store
    When the store is asked to seed again
    Then the blob store holds one blob per seeded species

  Scenario: An unknown species version has no image
    Given a freshly seeded pet shop store
    When the client requests the image of the species version "NoSuchSpeciesVersion00"
    Then the response is 404 Not Found
