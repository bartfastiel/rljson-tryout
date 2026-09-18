Feature: Bootstrap and catch-up
  A node that connects to its hub, whether it starts, restarts or comes back
  after a reconnection, compares the change sets it holds with the ones the
  hub holds, both read from the stores alone, pulls what it lacks and
  announces what the hub lacks; the hub does the same with every client it
  adds. A memory node that restarts is therefore complete again moments after
  it rejoined, a hub that restarts learns what its clients hold, and a node
  that joins with change sets of its own fills the others. The status of
  every node reports the last catch-up under sync.catchUp.

  Scenario: node3 restarts and catches up
    Given three nodes of one domain connected through their hub, node3 among the clients
    When node3 is stopped
    And "bowser-the-guard-dog" is renamed to "Bowser the Rested Guard Dog" on node1
    And Scrooge McDuck buys "donald-the-third" on node2
    And node3 starts again and joins the hub
    Then node3 lists that invoice and the new name within ten seconds
    And node3 holds the same rows as node1 and node2
    And the status of node3 reports a completed catch-up that pulled both change sets

  @in-process
  Scenario: A hub restarts and learns what the clients hold
    Given three nodes of one domain connected through their hub, node3 among the clients
    When the hub is stopped
    And "bowser-the-guard-dog" is renamed to "Bowser the Rested Guard Dog" on node1
    And Scrooge McDuck buys "donald-the-third" on node3
    And the hub starts again from the seed on the same port
    Then every node lists that invoice and the new name within ten seconds
    And every node holds the same rows

  @in-process
  Scenario: A node joining with a populated store announces what the hub lacks
    Given three nodes of one domain connected through their hub, node3 among the clients
    And a fourth node on its own, where Scrooge McDuck bought "donald-the-third"
    When the fourth node joins the hub
    Then every node lists that invoice within five seconds
    And the status of the hub counts that change set as received from the fourth node
