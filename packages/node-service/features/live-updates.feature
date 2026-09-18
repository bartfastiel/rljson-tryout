Feature: Live updates
  A node streams what happens to it over `GET /api/events` as server-sent
  events: an `insert` for every change set it writes itself, a `sync` for
  every change set transfer with another node, a `topology` whenever its
  place in the network changes. A browser tab that follows the stream
  refreshes what it shows without reloading the page.

  Scenario: Issuing an invoice emits an insert event
    Given a node whose event stream a client follows
    When Scrooge McDuck buys "donald-the-third" on that node
    Then the stream carries an insert event naming the invoice's change set, its rows and its ids

  Scenario: A synchronised change set emits a sync event
    Given a hub node and a client node connected to it
    And a client follows the event stream of the client node
    When Scrooge McDuck buys "donald-the-third" on the hub
    Then the client node's stream carries a pending and then a completed sync event for that change set from the hub
    And the client node lists that invoice
