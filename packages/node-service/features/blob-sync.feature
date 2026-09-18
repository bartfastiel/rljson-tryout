Feature: Blob synchronisation
  A species image is a blob in the node's blob store, named by its content
  id in the species row (`imageBlobId`). An image uploaded to one node
  writes a new species version with a change set; every other node pulls
  the version like any change set and then the blob through the hub's blob
  cascade, which caches it on the way, so that every node serves the same
  bytes at the new version's image URL. A node that holds the version
  without its blob fetches it on demand when the image is asked for.

  Scenario: A species image uploaded to node1 renders on node3 within five seconds
    Given three nodes of one domain connected through their hub
    When a PNG is uploaded as the image of the species "duck" on node1
    Then node3 lists that species version as current within five seconds
    And node3 serves the same bytes at the new version's image URL as image/png
    And node3's last transfer with node1 lists the blob with its size

  @in-process
  Scenario: A node that joins after the upload receives the image with the catch-up
    Given three nodes of one domain connected through their hub
    And node3 has left the network
    When a PNG is uploaded as the image of the species "duck" on node1
    And node3 joins the hub again
    Then node3 serves the same bytes at the new version's image URL within ten seconds
    And node3's last transfer with node1 lists the blob with its size

  @in-process
  Scenario: A node that holds the version without its blob fetches the image on demand
    Given three nodes of one domain connected through their hub
    And a PNG uploaded as the image of the species "duck" on node1 has reached node3
    When node3's blob store loses the image
    Then node3 serves the same bytes at the new version's image URL again and holds the blob once more
