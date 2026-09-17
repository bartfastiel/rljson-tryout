Feature: Discovery and roles
  The nodes of one rljson domain find each other by UDP broadcast, probe
  each other on the hub port and elect exactly one hub; every other node
  becomes a client of that hub. The status endpoint of every node shows the
  outcome, and the node directory of every node lists all nodes of the
  environment with the flag from discovery.

  Scenario: Three nodes start, exactly one becomes hub
    Given the three nodes of the Docker Compose setup are started
    When every node reports the two others as reachable peers
    Then exactly one node reports the role hub and the other two report client
    And all three nodes agree on the hub address
    And every node lists all three nodes of the environment as seen in the topology
