Feature: Identity persistence
  A node keeps its id in an identity file under its data directory. A node
  whose data directory outlives the process, the SQLite nodes on their
  volumes, comes back from a restart with the same id and a new start time,
  and reports the id as persistent; a memory node whose container or pod is
  replaced comes back with a fresh id, and its previous id leaves the other
  nodes' peer tables with the broadcast timeout. Discovery never refreshes
  a known peer's start time, so a hub that restarts within that timeout
  (about a second for a container, a few seconds for a pod) would leave
  the survivors following a node that no longer serves them. Every node
  therefore compares what its peers report about themselves with what
  discovery holds, keeps a peer whose start time moved out of its own hub
  election, and all nodes agree on one hub again within a minute. The
  status of every node reports its identity and, per peer, whether the
  peer is excluded from the election.

  Scenario: A sqlite node keeps its node id across a restart
    Given three nodes of one domain connected through their hub, node3 among the clients
    And the sqlite client among node1 and node2 reports an id generated at its start
    When that sqlite client is restarted within the peer timeout
    Then it reports the same node id, now restored from its data directory, and a later start time
    And it is connected to the same hub again within thirty seconds
    And the other nodes keep it out of their hub election within fifteen seconds

  Scenario: A memory node gets a fresh id and the old one disappears from the others within the peer timeout
    Given three nodes of one domain connected through their hub, node3 among the clients
    When node3 is recreated
    Then node3 reports a generated id that differs from its previous one
    And the previous id disappears from the peers of node1 and node2 within twenty-five seconds
    And every node is connected through the same hub again within thirty seconds

  Scenario: A hub restarted within two seconds is agreed upon again within one minute
    Given three nodes of one domain connected through their hub, node3 among the clients
    When the hub is restarted within the peer timeout
    Then all three nodes agree on one hub with the same hub address within one minute
    And exactly one node reports the role hub and its transport serves the two others
    And the restarted node reports the same node id as before

  @in-process
  Scenario: A survivor stops following a hub that returned with a new start time
    Given a node that follows an earlier peer as hub
    When that peer answers its status with the same node id and a later start time
    Then within the grace period the node excludes the peer from its election and becomes the hub itself
    And the exclusion is logged with its cause
