/**
 * One species the generator can add to the catalogue: its common name, its
 * Latin name and one Duckburg-flavoured sentence the description is built
 * around. The pool is a list rather than a set of random syllables so that
 * every generated species reads like a real animal with a real Latin name;
 * a size takes the first `n` entries, so the species of `medium` are the
 * first ten of `large`.
 */
export type SpeciesTemplate = {
  name: string;
  latinName: string;
  knownFor: string;
};

export const speciesPool: readonly SpeciesTemplate[] = [
  {
    name: 'Goose',
    latinName: 'Anser anser domesticus',
    knownFor:
      "Geese patrol Grandma Duck's farmyard with more authority than the Duckburg police and honk at the Beagle Boys on sight.",
  },
  {
    name: 'Pig',
    latinName: 'Sus scrofa domesticus',
    knownFor:
      'Pigs from the farms around Duckburg are clever enough to open a gate and polite enough to close it again behind them.',
  },
  {
    name: 'Cow',
    latinName: 'Bos taurus',
    knownFor:
      'Every glass of milk on Killmotor Hill comes from a cow that has heard Scrooge McDuck complain about the price of hay.',
  },
  {
    name: 'Horse',
    latinName: 'Equus ferus caballus',
    knownFor:
      'Duckburg horses still pull the occasional milk cart and have outrun more than one of Gyro Gearloose’s prototypes.',
  },
  {
    name: 'Mouse',
    latinName: 'Mus musculus',
    knownFor:
      'Mice keep out of the money bin on principle: the coins are too cold and the guard dog too attentive.',
  },
  {
    name: 'Cat',
    latinName: 'Felis catus',
    knownFor:
      'A Duckburg cat will sit on any newspaper, any ledger and any treasure map the moment somebody needs to read it.',
  },
  {
    name: 'Rabbit',
    latinName: 'Oryctolagus cuniculus',
    knownFor:
      'Rabbits multiply almost as fast as the interest in Scrooge McDuck’s vault and are about as easy to keep in one place.',
  },
  {
    name: 'Goat',
    latinName: 'Capra aegagrus hircus',
    knownFor:
      'Goats have eaten at least three of Gyro Gearloose’s blueprints and, by all accounts, improved them.',
  },
  {
    name: 'Sheep',
    latinName: 'Ovis aries',
    knownFor:
      'The wool for every sailor suit in Duckburg starts on a sheep that has never once been to sea.',
  },
  {
    name: 'Parrot',
    latinName: 'Psittacus erithacus',
    knownFor:
      'Parrots repeat everything they hear, which is why none of them are allowed near the money bin during an audit.',
  },
  {
    name: 'Canary',
    latinName: 'Serinus canaria domestica',
    knownFor:
      'Canaries sing through every storm Donald Duck brings home and have never once lost their temper about it.',
  },
  {
    name: 'Budgerigar',
    latinName: 'Melopsittacus undulatus',
    knownFor:
      'Budgerigars learn the combination to a safe faster than any Beagle Boy and are far worse at keeping it to themselves.',
  },
  {
    name: 'Goldfish',
    latinName: 'Carassius auratus',
    knownFor:
      'Goldfish are the only animals Gyro Gearloose buys rather than builds, and he still fits their bowl with a thermostat.',
  },
  {
    name: 'Hamster',
    latinName: 'Mesocricetus auratus',
    knownFor:
      'A hamster’s cheek pouches hold roughly one day of Scrooge McDuck’s loose change, as one memorable afternoon proved.',
  },
  {
    name: 'Guinea pig',
    latinName: 'Cavia porcellus',
    knownFor:
      'Guinea pigs squeak the moment a lettuce leaf enters the room and have never been wrong about it.',
  },
  {
    name: 'Tortoise',
    latinName: 'Testudo hermanni',
    knownFor:
      'Tortoises outlast every fad, every fortune and, in one documented case, three owners of the same Duckburg bakery.',
  },
  {
    name: 'Ferret',
    latinName: 'Mustela putorius furo',
    knownFor:
      'Ferrets can find anything that has been hidden, which makes them popular with detectives and unpopular with the Beagle Boys.',
  },
  {
    name: 'Pigeon',
    latinName: 'Columba livia domestica',
    knownFor:
      'Duckburg pigeons carry messages faster than the post office and read them more carefully.',
  },
  {
    name: 'Swan',
    latinName: 'Cygnus olor',
    knownFor:
      'Swans glide across Audubon Bay as if they own it, and the harbour master has stopped arguing.',
  },
  {
    name: 'Peacock',
    latinName: 'Pavo cristatus',
    knownFor:
      'Peacocks were first imported by John D. Rockerduck to outshine the money bin and, on sunny days, very nearly do.',
  },
  {
    name: 'Owl',
    latinName: 'Strix aluco',
    knownFor:
      'Owls keep the same hours as Magica De Spell and have watched more of her spells fail than anyone.',
  },
  {
    name: 'Raven',
    latinName: 'Corvus corax',
    knownFor:
      'Ravens are barred from the money bin after one of them proved that a dime can be carried in a beak.',
  },
  {
    name: 'Magpie',
    latinName: 'Pica pica',
    knownFor:
      'Magpies and Scrooge McDuck have a long-standing disagreement about who saw a given coin first.',
  },
  {
    name: 'Hedgehog',
    latinName: 'Erinaceus europaeus',
    knownFor:
      'Hedgehogs roll up at the first sign of trouble, a strategy Donald Duck has often been advised to copy.',
  },
  {
    name: 'Squirrel',
    latinName: 'Sciurus vulgaris',
    knownFor:
      'Squirrels bury their nuts the way Scrooge buries his fortune, except that the squirrels occasionally forget where.',
  },
  {
    name: 'Fox',
    latinName: 'Vulpes vulpes',
    knownFor:
      'Foxes have out-thought every henhouse lock Gyro Gearloose ever designed, including the one with the moat.',
  },
  {
    name: 'Beaver',
    latinName: 'Castor fiber',
    knownFor:
      'Beavers dammed the creek below Killmotor Hill twice, and both times Scrooge tried to charge them rent.',
  },
  {
    name: 'Otter',
    latinName: 'Lutra lutra',
    knownFor:
      'Otters dive into Audubon Bay after anything that glints, which has made them honorary members of the Junior Woodchucks.',
  },
  {
    name: 'Frog',
    latinName: 'Rana temporaria',
    knownFor:
      'The frogs of Tangleweed Trail sing every evening, and Fethry Duck has been trying to conduct them for years.',
  },
  {
    name: 'Turtle',
    latinName: 'Trachemys scripta',
    knownFor:
      'Turtles have crossed the Duckburg harbour road so slowly that traffic lights were installed on their behalf.',
  },
  {
    name: 'Lizard',
    latinName: 'Lacerta agilis',
    knownFor:
      'Lizards sun themselves on the money bin’s steps and are the only visitors Scrooge never chases away.',
  },
  {
    name: 'Koi',
    latinName: 'Cyprinus rubrofuscus',
    knownFor:
      'Koi in the Rockerduck Tower fountain are worth more than the fountain, which is exactly how their owner likes it.',
  },
  {
    name: 'Trout',
    latinName: 'Salmo trutta',
    knownFor:
      'Trout from the streams above Duckburg have escaped every one of Donald Duck’s fishing trips.',
  },
  {
    name: 'Chinchilla',
    latinName: 'Chinchilla lanigera',
    knownFor:
      'Chinchillas take a dust bath every evening and look better after it than most Duckburg citizens after a real one.',
  },
  {
    name: 'Llama',
    latinName: 'Lama glama',
    knownFor:
      'Llamas came back from one of Scrooge McDuck’s Andes expeditions and have refused to carry anything since.',
  },
  {
    name: 'Alpaca',
    latinName: 'Vicugna pacos',
    knownFor:
      'Alpacas hum when content, which around Grandma Duck’s kitchen is most of the time.',
  },
  {
    name: 'Donkey',
    latinName: 'Equus asinus',
    knownFor:
      'Donkeys have carried the Junior Woodchucks up every hill around Duckburg and have opinions about each one.',
  },
  {
    name: 'Turkey',
    latinName: 'Meleagris gallopavo',
    knownFor:
      'Turkeys strut across the farmyard every autumn with the confidence of a bird that has not read the calendar.',
  },
  {
    name: 'Penguin',
    latinName: 'Spheniscus demersus',
    knownFor:
      'Penguins arrived with a shipment of ice for the money bin’s cooling system and never asked to go back.',
  },
  {
    name: 'Seal',
    latinName: 'Phoca vitulina',
    knownFor:
      'Seals bask on the Duckburg pier and applaud every boat that Donald Duck fails to dock properly.',
  },
  {
    name: 'Kangaroo',
    latinName: 'Macropus rufus',
    knownFor:
      'A kangaroo once bounced a Beagle Boy clean over the money bin fence, and the fence was raised the next day.',
  },
  {
    name: 'Bee',
    latinName: 'Apis mellifera',
    knownFor:
      'Duckburg bees make the honey for Grandma Duck’s pies and guard the hives more fiercely than any bank.',
  },
  {
    name: 'Snail',
    latinName: 'Helix pomatia',
    knownFor:
      'Snails are the one species that has never been late for anything, because nobody expects them on time.',
  },
  {
    name: 'Crow',
    latinName: 'Corvus corone',
    knownFor:
      'Crows count the dimes on the money bin steps and, according to Scrooge, always come up one short.',
  },
  {
    name: 'Salamander',
    latinName: 'Salamandra salamandra',
    knownFor:
      'Salamanders live under the damp stones of Killmotor Hill and glow, very faintly, after a visit from Magica De Spell.',
  },
  {
    name: 'Newt',
    latinName: 'Lissotriton vulgaris',
    knownFor:
      'Newts were the subject of Gyro Gearloose’s first invention, a tiny raincoat, which they did not need.',
  },
  {
    name: 'Gerbil',
    latinName: 'Meriones unguiculatus',
    knownFor:
      'Gerbils dig tunnels with the same energy the Beagle Boys put into theirs and rather more success.',
  },
  {
    name: 'Cockatiel',
    latinName: 'Nymphicus hollandicus',
    knownFor:
      'Cockatiels whistle the Duckburg anthem on request and the Beagle Boys’ prison song without one.',
  },
  {
    name: 'Chameleon',
    latinName: 'Chamaeleo calyptratus',
    knownFor:
      'Chameleons change colour on a whim, which Magica De Spell considers cheating and Gyro considers research.',
  },
  {
    name: 'Hen harrier',
    latinName: 'Circus cyaneus',
    knownFor:
      'Hen harriers circle above the farms all summer, and no chicken of Gearloose Workshop Hatchery takes them lightly.',
  },
  {
    name: 'Pony',
    latinName: 'Equus ferus caballus',
    knownFor:
      'Ponies give rides at every Duckburg fair and have thrown exactly one rider, Gladstone Gander, who landed on a cushion.',
  },
  {
    name: 'Stork',
    latinName: 'Ciconia ciconia',
    knownFor:
      'Storks nest on the roof of the Duckburg town hall and deliver nothing but opinions.',
  },
  {
    name: 'Heron',
    latinName: 'Ardea cinerea',
    knownFor:
      'Herons stand in the shallows of Audubon Bay for hours, which is longer than most citizens spend waiting for anything.',
  },
  {
    name: 'Mole',
    latinName: 'Talpa europaea',
    knownFor:
      'Moles have tunnelled under every lawn on Killmotor Hill except one, which is bank-vault steel to a depth of six metres.',
  },
  {
    name: 'Badger',
    latinName: 'Meles meles',
    knownFor:
      'Badgers keep their setts as tidy as Grandma Duck keeps her kitchen and dislike visitors exactly as much.',
  },
];
