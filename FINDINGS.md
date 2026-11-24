# FINDINGS : le job d'auto-matching

> Brouillon en français. L'ordre est provisoire, je reclasse par gravité à la fin.

## Résumé

Le job ne respecte pas le principe posé par le README : quand aucun candidat n'est convaincant, la transaction doit rester non rapprochée. Le code rapproche dès qu'une facture a le bon montant dans la fenêtre de dates. Il ne vérifie pas que les lignes ont le droit d'être rapprochées, et il surtout devine quand plusieurs factures conviennent.

Deux défauts s'y ajoutent. Le résultat dépend du fuseau horaire de la machine (le code est en utc mais la base depend du fuseau du serveur). Et chaque exécution réécrit celle d'avant, sans laisser de trace.

---

## 0. Premier lancement : une erreur dans la console

**Problème.** Chaque exécution affiche `skip TypeError: Cannot read properties of null (reading 'trim')`.
- La transaction `e0000013-...-001` (-333,33€, "PRLV SEPA ASSURANCE") n'a qu'une facture candidate : 277,78+55,55, échéance le 18/01/2026.
- Cette facture n'a pas de fournisseur (`supplier_name` est NULL), donc `normalizeLabel(null)` plante.
- Le `catch` affiche "skip" suivi de l'erreur, puis le job continue.

**Conséquence.** Cette erreur révèle deux problèmes :
- Une donnée incomplète fait perdre un rapprochement qui était le seul possible. La même facture bloquerait toute autre transaction dont elle serait candidate.
- L'erreur ne dit pas quelle transaction est concernée, j'ai du ajouter du code pour savoir d'ou ca venait, et le job se termine normalement. Personne ne saura qu'elle a été sautée.

---

## 4. Montant + date ne suffisent pas à prouver un paiement

**Problème.** Le README demande un candidat "convaincant". Le code se contente du montant et de la fenêtre de dates. Le libellé bancaire (nom du fournisseur, numéro de facture) ne sert qu'à départager plusieurs candidats, via un malus dans le code. Il ne sert jamais à exiger une preuve ni à écarter un candidat.

**Conséquence.** Des paiements sont imputés au mauvais fournisseur, alors que le libellé dit clairement qui a été payé. La facture choisie apparaît réglée et la vraie reste ouverte. Or les montants se répètent beaucoup : 35017 factures pour seulement 25702 totaux différents, et 153 factures Orange à 59,99€. Avoir le même montant ne prouve rien.

---

## 2. Rien ne filtre les lignes qui ont le droit d'être rapprochées

**Problème.** Les deux requêtes prennent toutes les transactions et toutes les factures de la société, sans aucune condition. Le README parle des transactions sortantes non rapprochées. Le code prend aussi :
- les encaissements : à cause de Math.abs, un virement reçu peut "payer" une facture fournisseur du même montant
- les transactions supprimées
- les transactions encore "Pending"
- les transactions déjà rapprochées
- les factures annulées
- les factures supprimées

**Conséquence.** une écriture fausse :
- un encaissement client rapproché d'une facture fournisseur fausse les deux comptabilités
- un rapprochement sur une facture annulée laisse ouverte la facture réellement payée.

---

## 6. Chaque exécution réécrit tout, sans laisser de trace

**Problème.** Le job ne filtre pas les transactions déjà rapprochées et écrit sans condition. La base ne garde rien qui indique qui a rapproché (le job ou un utilisateur), ni quand, ni lors de quelle exécution. Et quand le job ne trouve plus de candidat, il ne touche à rien : un rapprochement devenu faux ou ambigu n'est jamais retiré.

**Conséquence.**
- Un rapprochement fait à la main par un utilisateur peut être écrasé.
- Un rapprochement que l'utilisateur a défait est recréé à l'exécution suivante.
- Après une mauvaise exécution (bug, mauvais déploiement), on ne peut pas lister ce qu'elle a écrit, donc on ne peut pas l'annuler sans toucher aux rapprochements manuels. D'après le README, ce code est déjà en production : rapprochements automatiques et manuels y sont donc déjà mélangés.

---

## 8. Les montants en flottants font rater des rapprochements

**Problème.** Les montants sont stockés en float et on fait des comparaison en JS avec ===, donc on a des soucis de representations classiques qui font que le resultat ne tombe pas exact très souvent.

**Conséquence.** Des rapprochements évidents ne sont jamais faits, sans aucune erreur.

---

## 9. Les échecs passent inaperçus

**Problème.** Chaque transaction est traitée dans un try/catch qui affiche "skip" et l'erreur, sans identifiant, puis passe à la suivante et le process sort avec le code 0 dès lors que la société a été trouvée.

**Conséquence.**
- Si la base redémarre ou devient injoignable pendant l'exécution, toutes les transactions restantes sont sautées en quelques millisecondes. Le job affiche "Matched N of 1200", se termine normalement, et le planificateur enregistre un succès.
- Une requête bloquée peut aussi faire durer une exécution indéfiniment, jusqu'à chevaucher la suivante.

---

## 7. Le résultat dépend du fuseau horaire de la machine

**Problème.** node-pg convertit une colonne `date` en objet `Date` à minuit, heure locale. `due_date`, lui, est un texte (`'YYYY-MM-DD'`) que `new Date()` interprète comme minuit UTC. `dayDiff` soustrait les deux.

**Conséquence.** Sur une machine à l'heure de Paris, toutes les différences sont décalées d'un jour. Le même job, sur les mêmes données, produit donc des rapprochements différents selon le serveur.


---

## 1. Le job devine quand plusieurs factures conviennent

**Problème.** Quand plusieurs factures ont le bon montant dans la fenêtre, le code les classe et prend la première. En cas d'égalité, c'est l'ordre dans lequel la base renvoie les lignes qui décide.

**Conséquence.** Le README demande de laisser la transaction non rapprochée quand aucun candidat n'est convaincant, mais le job choisit quand même. Pour un abonnement, le paiement est imputé à l'échéance la plus proche, qui n'est pas forcément celle réellement payée, et la vraie facture reste ouverte. L'écriture a l'air plausible, donc personne ne la vérifiera.

---

## 5. La lecture du libellé est fausse

**Problème.** Le bonus de libellé teste label.includes(nom) après un simple trim().toLowerCase() :
- une chaîne vide est contenue dans n'importe quel texte : une facture sans numéro reçoit donc le bonus pour toutes les transactions
- la recherche porte sur une sous-chaîne et non sur un mot : "sfr" est trouvé dans "sfri"
- un fournisseur NULL fait planter le job
- citer le numéro de facture donne le même bonus que citer le fournisseur, alors que le numéro est plus précis, c'est pas très logique ;
- la colonne "reference", qui sert à ça a priori, n'est jamais lue ;
- les raisons sociales apparaissent rarement telles quelles dans un libellé ("Slack Technologies ", ou "Total Energies" face à "TOTALENERGIES") : la bonne facture ne reçoit pas le bonus.

---

## 3. Une même facture rapprochée plusieurs fois

**Problème.** Les factures déjà rapprochées ne sont pas exclues des candidats. Chaque transaction est traitée indépendamment, et rien en base n'empêche deux transactions de pointer vers la même facture.

**Conséquence.**
- Une facture apparaît payée deux ou trois fois.
- Quand un fournisseur est réellement payé deux fois de suite, le second paiement règle en fait une autre facture. 
- Un débit en double, que le client devrait probablement contester a sa banque, apparaît comme réglé.

---

## 10. Performance

**Problème.** getCandidates est appelée à chaque tour de boucle. Toutes les factures de la société sont rechargées pour chaque transaction, sans filtre ni index.

**Conséquence.** On transfère 1200 × 35017 = 42 millions de lignes en 1708 requêtes, soit environ 50 secondes pour une société de taille modeste. L'essentiel du temps est passé dans Node à décoder des lignes qui sont jetées. Le coût grandit avec l'historique de factures de chaque client, et chaque requête relit toute la table des factures.

---

## Autres points

- **Entrée du programme écrite en dur et injectée dans le SQL.** Le SIREN est écrit en dur dans main, puis injecté tel quel dans la requête, comme toutes les autres valeurs. C'est pas exploitable aujourd'hui, mais ça le devient dès que le SIREN viendra d'une entrée utilisateur (API, ligne de commande, file de messages). Le job tourne en plus avec le superutilisateur Postgres.
- **Le SIREN n'est pas unique en base.** `rows: [company]` prend la première ligne venue s'il existe un doublon.
- **Une transaction sur un compte inexistant disparaît sans bruit.** `e0000011` est rattachée au compte `ac...099`, qui n'existe pas. La jointure l'écarte sans rien signaler (pas de clé étrangère).
- **Les factures sans échéance sont exclues par accident.** Elles sont 1 051 : `new Date(null)` vaut le 1er janvier 1970, toujours hors fenêtre. Le résultat est le bon, mais un peu par hasard.
- **`db:reset` est un peu dangereux.** Il supprime le schéma de la base désignée par les variables `PG*` (si on a un autre projet ou des var d'env sur le pc, il faut faire attention)

## Qualité du code

- **Typage des lignes.** `TransactionRow` et `InvoiceRow` ne sont que des déclarations posé sur un `select *`. Elles déclarent `string` pour des colonnes qui peuvent être NULL (`supplier_name`, `due_date`), et omettent les colonnes dont la règle a besoin (`status`, `deleted_at`, `matched_invoice_id`, `invoice_status`). TypeScript détecte donc pas certains plantage de type.
- **Pas de dry-run.** aucun moyen de voir ce qu'une modification de la règle écrirait avant qu'elle n'écrive dans la comptabilité des clients.
- **La logique de décision est mêlée aux accès à la base.** `findMatch` et `scoreCandidate` ne sont pas exportées, et le pool de connexions est global. On ne peut pas tester la décision sans base.
- **Les tests ne vérifient rien de décisif, et rien ne vérifie les types.** Les tests couvrent deux petites fonctions utilitaires.

## Trouvé pendant la refonte

### Les gros montants ont peut-être déjà perdu leurs centimes

**Problème.** Pour passer les montants en `numeric`, il faut convertir les valeurs `real` existantes. Deux pièges :
- la conversion directe `real::numeric` ne garde que 6 chiffres significatifs : 12 345,67 devient 12 345,70 ;
- plus grave, `real` ne garde qu'environ 7 chiffres significatifs dès l'enregistrement. Au-delà de 131 072 €, deux montants qui diffèrent d'un centime peuvent être stockés sous la même valeur.

**Conséquence.** Si la base de production contient des montants au-delà de ce seuil, certains ont pu être enregistrés faux dès l'origine, sans aucune erreur. L'écart grandit avec le montant : au plus 1 centime jusqu'à 262 144 €, jusqu'à 3 centimes vers 1 M€, jusqu'à 50 centimes vers 10 M€. Aucune migration ne peut retrouver la valeur d'origine à partir de la base, et une comparaison exacte ne rapprochera jamais un montant faux d'un centime de sa facture.

**Correction.**
- La migration passe par `float8` puis arrondit au centime : `round(col::float8::numeric, 2)`. C'est exact tant que le `real` n'avait pas déjà perdu le centime.
- Avant de migrer en production, compter les montants concernés (`abs(amount) >= 131072`, et de même pour les factures). S'il y en a, les corriger depuis la source : réimport du flux bancaire grâce à `remote_id`, nouvelle extraction de la facture d'origine.

### Exiger une preuve fait aussi manquer des rapprochements justes

**Constat.** La refonte n'accepte une facture que si le libellé bancaire la désigne : par son numéro, ou par le nom du fournisseur, dont tous les mots distinctifs doivent apparaître en mots entiers. Sur le seed, les rapprochements passent de 551 à 461. Les 92 perdus se répartissent ainsi :
- 48 dont le libellé ne contient aucun mot du fournisseur de la facture. C'étaient de mauvais fournisseurs : "VIR TRANSGOURMET" → Uber, "CB AMAZON BUSINESS EU" → Microsoft. Les perdre est voulu.
- 44 où le fournisseur est probablement le bon, mais où le libellé n'écrit qu'une partie de son nom : "CB SLACK T0123" → Slack Technologies, "CB METRO PARIS NANTERRE" → Metro Cash & Carry, "VIR SEPA LEFEBVRE AVOCATS" → Cabinet Lefebvre Avocats, "CB SNCF INTERNET" → SNCF Voyageurs. Ceux-là sont des rapprochements justes manqués.

**Pourquoi je garde la règle stricte.** Le README dit : un faux rapprochement est pire qu'une absence de rapprochement. Une transaction non rapprochée reste visible, et le client la traite à la main. Un faux rapprochement passe inaperçu. Or une règle plus souple, où un seul mot du nom suffirait, désigne à tort un autre fournisseur dans une vingtaine de libellés du seed : "PRO" trouve Free Pro dans "CB LEROY MERLIN PRO", "DUPONT" trouve Imprimerie Dupont dans l'encaissement "VIR RECU CLIENT DUPONT", "CABINET" confond trois cabinets différents.

**Pour récupérer ces cas sans perdre en précision.** Il faudrait une table d'alias par société ("SLACK" → Slack Technologies), apprise à partir des rapprochements que l'utilisateur fait ou confirme à la main. Elle est déterministe et explicable, et l'IA pourrait proposer des alias qu'un humain valide.
