Feature: Seed sizes and the animal search
  A node seeds its store once, at its first start, with the size its
  configuration names. The hand-written Duckburg seed is the core of every
  size; medium and large add generated Duckburg rows whose hashes are the
  same on every node. The animal list stays usable at any size, because the
  node searches and pages it.

  Scenario: A node seeded with the medium size reports its tables
    Given a pet shop store seeded with the size "medium"
    When the client requests the stats
    Then the stats report the seed size "medium" and 110 animals
    And every table has as many InsertHistory rows as rows

  Scenario: The animal list is paged and searched on the node
    Given a pet shop store seeded with the size "medium"
    When the client requests the first page of animals
    Then the page holds 50 of 110 animals
    When the client requests the animals matching "quack"
    Then every animal on the page has "quack" in its name or species
    And the page reports fewer animals than the store holds

  Scenario: Two nodes seeded with the same size hold the same animal versions
    Given two pet shop stores seeded with the size "medium"
    Then both stores serve the same animal hashes
