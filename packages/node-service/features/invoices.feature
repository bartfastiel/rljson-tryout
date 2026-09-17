Feature: Customers and invoices
  A customer buys animals and gets an invoice. The node writes the invoice,
  one item per animal and one change set naming every row it wrote, so that
  the sale is one logical change other nodes can pull as a whole. An invoice
  that would be wrong is refused before anything is written.

  Scenario: Scrooge buys Donald the duck
    Given a freshly seeded pet shop store
    When Scrooge McDuck buys the animal "donald-the-third"
    Then the node answers 201 with an open invoice for "Scrooge McDuck"
    And the invoice list shows that invoice with one item
    And the invoice total equals the price of "donald-the-third"
    And the invoice detail names the change set that wrote it

  Scenario: An invoice without items is refused
    Given a freshly seeded pet shop store
    When Scrooge McDuck sends an invoice with no items
    Then the node answers 400 with the message "An invoice needs at least one item."
    And the invoice list is unchanged

  Scenario: An invoice for an unknown animal is refused
    Given a freshly seeded pet shop store
    When Scrooge McDuck buys the animal "gizmoduck"
    Then the node answers 400 with a message naming the animal "gizmoduck"
    And the invoice list is unchanged
