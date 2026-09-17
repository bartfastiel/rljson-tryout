Feature: Traits as a multi-reference and as a junction table
  Every animal can carry zero or more traits, stored either on
  `animals.traitsRefs` as a `jsonArray` of trait hashes (slice B5) or as rows
  of the `animalTraits` junction table (slice B6); `docs/findings/n-to-m.md`
  compares the two. A visitor filters the animal list by one trait, sees an
  animal's traits by name on its detail page, and can combine a trait filter
  with the existing species filter; the filter answers identically no matter
  which representation is configured.

  Scenario: Filtering by a trait returns only animals carrying it
    Given a freshly seeded pet shop store
    When the client requests the animals with the trait "competitive-streak"
    Then every returned animal carries the trait "competitive-streak"
    And not every seeded animal is returned

  Scenario: An animal detail lists its traits by name
    Given a freshly seeded pet shop store
    When the client requests the seeded animal "sir-quackington"
    Then the response lists a trait named "Fiercely loyal"

  Scenario: A species filter and a trait filter combine
    Given a freshly seeded pet shop store
    When the client requests the animals of species "chicken" with the trait "competitive-streak"
    Then exactly the animal "henrietta-the-egg-champion" is returned

  Scenario: An unknown trait id filters out every animal
    Given a freshly seeded pet shop store
    When the client requests the animals with the trait "telekinesis"
    Then the response is an empty page

  Scenario Outline: The trait filter answers identically in both trait relation modes
    Given a freshly seeded pet shop store reading traits through "<mode>"
    When the client requests the animals with the trait "competitive-streak"
    Then every returned animal carries the trait "competitive-streak"
    And not every seeded animal is returned

    Examples:
      | mode            |
      | multi-reference |
      | junction        |
