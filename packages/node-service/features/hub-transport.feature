Feature: Hub transport
  The hub of an rljson domain serves its store to the other nodes over the
  hub port, and every client reads what it does not hold from the hub. A
  row keeps its hash on every node, so a client can ask for exactly the
  version another node wrote; what a client holds itself only grows once
  change sets are synchronised (slice D3), so until then the row is readable
  by hash but not listed.

  Scenario: A row written on the hub is readable by hash on a client
    Given a hub node and a client node connected to it
    When the price of "donald-the-third" is changed to 61000 cents on the hub
    Then the client serves that version of "donald-the-third" by its hash at 61000 cents
    And the client still lists "donald-the-third" at its old price

  Scenario: An invoice issued on the hub is readable by id on a client
    Given a hub node and a client node connected to it
    When Scrooge McDuck buys "donald-the-third" on the hub
    Then the client serves that invoice by its id with one item
    And the status of the hub counts every client as connected
