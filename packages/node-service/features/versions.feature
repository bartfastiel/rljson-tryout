Feature: Versions of an entity
  A row never changes. An edit writes a new row plus an InsertHistory row
  whose `previous` names the version it supersedes, so the versions of one
  animal form a chain and the current version is the tip of that chain
  (roadmap section 2.6, `docs/findings/entity-versions.md`). The shop
  keeper edits an animal, every list shows the new version, and the history
  keeps every version readable.

  Scenario: The price of an animal changes
    Given a freshly seeded pet shop store
    When the shop keeper changes the price of "donald-the-third" to 61000 cents
    Then the node answers 200 with the animal priced at 61000 cents
    And the animal list shows "donald-the-third" priced at 61000 cents, once
    And the animal detail shows "donald-the-third" priced at 61000 cents
    And the history of "donald-the-third" lists two versions, newest first
    And only the new version is current and it names the old one as previous
    And the old version is still readable by its hash at its old price

  Scenario: An edit keeps the traits
    Given a freshly seeded pet shop store
    When the shop keeper renames "sir-quackington" to "Sir Quackington the First"
    Then the animal detail shows the name "Sir Quackington the First"
    And the animal detail still lists a trait named "Fiercely loyal"
    And the trait filter "fiercely-loyal" still returns "sir-quackington"
    And both versions in the history carry the same traits

  Scenario: An invalid edit is refused and writes nothing
    Given a freshly seeded pet shop store
    When the shop keeper changes the price of "donald-the-third" to -1 cents
    Then the node answers 400 with the message "The price must be a whole number of cents, at least 0."
    And the history of "donald-the-third" lists one version
