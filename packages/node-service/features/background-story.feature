Feature: Long background story
  Every animal in the pet shop has a background story, and one seeded animal
  has a very long one. The store and the HTTP API must carry a story of
  several thousand characters through unchanged, since that is exactly the
  kind of value a naive implementation truncates or mangles.

  Scenario: A long story round-trips through the store unchanged
    Given a freshly seeded pet shop store
    And an animal with a generated 4000 character background story
    When the animal is written through the store
    And the same animal is read back from the store by its id
    Then the read-back story is exactly 4000 characters long
    And the read-back story equals the story that was written
    And the read-back row hash equals the hash of the written animal row

  Scenario: The HTTP API serves the long background story of a seeded animal
    Given a freshly seeded pet shop store
    When the client requests the seeded animal with the longest background story
    Then the response includes the species name
    And the response's background story is at least 4000 characters long
