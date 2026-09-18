Feature: Change set synchronisation
  Every change a node writes is one change set: the rows it wrote and their
  InsertHistory rows, named by hash. A node announces the hash of every
  change set it writes, the hub relays it to every other node, and each
  node pulls the change set and its rows by hash and writes them as they
  came. A change made on one node therefore shows on every node within
  seconds, as the current version, and a change set that is announced
  again is written once.

  Scenario: An invoice issued on node3 appears on node1 and node2 within five seconds
    Given three nodes of one domain connected through their hub
    When Scrooge McDuck buys "donald-the-third" on node3
    Then node1 and node2 list that invoice within five seconds
    And node1 and node2 serve that invoice by its id with its item and its change set hash
    And the status of node1 and node2 counts one change set received from node3

  Scenario: An animal renamed on node2 shows the new name on node1 and node3 within five seconds
    Given three nodes of one domain connected through their hub
    When "bowser-the-guard-dog" is renamed to "Bowser the Retired Guard Dog" on node2
    Then node1 and node3 list "bowser-the-guard-dog" as "Bowser the Retired Guard Dog" within five seconds
    And node1 and node3 show the renamed version as current, chained to the seed version

  @in-process
  Scenario: The transfers with a node and the rows an edit carried are served to the web app
    Given three nodes of one domain connected through their hub
    When "bowser-the-guard-dog" is renamed to "Bowser the Retired Guard Dog" on node2
    Then node1 and node3 list that change set as their last transfer with node2 within five seconds
    And node2 lists it as its last transfer with the hub
    And node1 serves that change set with the animal's name before and after

  Scenario: A change set announced again is written once
    Given three nodes of one domain connected through their hub
    And Scrooge McDuck bought "donald-the-third" on the hub and every client holds that change set
    When a client restarts and joins the hub again
    Then the restarted client holds that change set within ten seconds
    And the other client still lists that invoice once and holds that change set once
