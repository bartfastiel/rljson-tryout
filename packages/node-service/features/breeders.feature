Feature: Persons and breeders
  Every animal comes from a breeder, and every breeder is a person running a
  farm or a kennel. A visitor sees the breeders of this node with the person
  behind each one, narrows the animal list to one breeder, and sees an
  animal's own breeder named on its detail page.

  Scenario: The breeder list shows every breeder with their person data
    Given a freshly seeded pet shop store
    When the client requests the breeders
    Then every returned breeder includes its supplying person's name and city

  Scenario: An animal detail names its breeder
    Given a freshly seeded pet shop store
    When the client requests the seeded animal "sir-quackington"
    Then the response names the breeder "Daisy's Duckling Nursery"

  Scenario: Filtering animals by breeder returns only animals from that breeder
    Given a freshly seeded pet shop store
    When the client requests the animals of the breeder "grandma-ducks-farm"
    Then every returned animal was bred by "Grandma Duck's Farm"
    And not every seeded animal is returned
