# Semantic Open Data

Dieses Projekt entstand im Rahmen des [Public AI Hackathons](https://www.digitalaustria.gv.at/wissenswertes/events/publicaihackathon.html),
organisiert von der TU Austria in Kooperation mit dem Bundeskanzleramt (BKA). Der Hackathon fand vom 4. bis 5. Mai 2026 
in Wien statt, um reale Herausforderungen der öffentlichen Verwaltung durch innovative KI-Lösungen zu bewältigen.

## IST-Stand und Projektmotivation

`data.gv.at` ist das zentrale Open-Data-Portal der österreichischen Verwaltung mit über 68.500 Datensätzen von mehr als 
2.200 Organisationen. Die größte Hürde bei der Nutzung ist die starke Heterogenität der Datenformate und Metadatenqualitäten.

Bisher scheitert eine effiziente Nutzung oft an fehlender semantischer Strukturierung und uneinheitlichen Beschreibungen. 
Dies macht die Daten schwer maschinenlesbar und erfordert hohes Domänenwissen von Endnutzern, um relevante Daten 
überhaupt zu identifizieren und zu vergleichen. Ein niederschwelliger, KI-gestützter Zugang soll dies ändern, um neue 
Marktchancen für Unternehmen zu eröffnen, Lizenzgebühren zu sparen und Transparenz zu schaffen

## Zielgruppen und abgeleitete Use-Cases

Unser System adressiert die primären Schmerzpunkte der zwei Haupt-Stakeholder:

### Data Consumers (Unternehmen, Bürger, Unis):

  **Pain Points der aktuellen Plattform:**

  Data Consumers suchen Datensätze über ein Textfeld, das auf einer klassischen Elastic-Search basiert. Da diese Methode primär 
    auf exaktem Keyword-Matching (z. B. in Titeln) beruht, wird die Semantik der Anfrage nicht verstanden. Wer nicht exakt 
    den Fachjargon der Verwaltung nutzt, erhält schlechte oder keine Ergebnisse. Zudem scheitert das System an 
    mehrdimensionalen Suchanfragen.

  **Unsere abgeleiteten Use-Cases:**
    
  - **Hybride Suche:** r erweitern das System um einen Hybrid-Ansatz, bei dem die klassische, exakte Textsuche und eine 
    neue semantische Vektorsuche parallel ausgeführt werden. Während die klassische Suche punktgenau nach Keywords filtert, 
    liefert die semantische Suche inhaltlich ähnliche Dokumente basierend auf den wichtigsten Metadaten (Titel, 
    Beschreibung, Keywords). Beide Suchstränge werden anschließend zu einer aggregierten Trefferliste kombiniert. So versteht
    das System Suchanfragen in natürlicher Sprache, ohne die Präzision exakter Treffer zu opfern.
    
    - **Agentic Search für komplexe Queries:** Aktuell ist die Suche singulär. Sucht jemand z. B. nach "Gesundheitsentwicklung 
    Wiens im Vergleich zum Rauchverhalten", liefert das System keine kombinierten Ergebnisse. Unser Ansatz nutzt einen 
    KI-Agenten, der solche komplexen Anfragen aufsplittet, mittels Tools iterativ gezielte Suchanfragen an `data.gv.at` stellt 
    und die relevanten Datensätze intelligent zusammenführt.

    - **LLM-basiertes Reranking:** Nach dem initialen Retrieval (über die Hybrid Search) implementieren wir einen LLM-
    gestützten Relevanz-Filter (Reranker). Dieser analysiert die Suchergebnisse noch einmal tiefgehend und bringt die 
    Dokumente ganz nach oben, die den wahren Intent der User-Query am besten bedienen.

### Data Producers (Ämter, Gemeinden, öffentlicher Dienst)
    
  **Pain Points der aktuellen Plattform:**
    
  Selbst die beste semantische Suche läuft ins Leere, wenn die Datensätze keine oder nur schlechte Metadaten besitzen. Das 
    manuelle Ausfüllen dieser Felder ist für Verwaltungsmitarbeiter jedoch ein ungeliebter und zeitaufwendiger Prozess.
    
  **Unsere abgeleiteter Use-Case:**
    
  - **KI-gestützte Metadatengenerierung beim Upload:** Um das Problem mangelhafter Metadaten zu entschärfen, greift unser 
    System direkt beim Upload-Prozess neuer Daten ein. Bei textbasierten Dokumenten (z. B. PDF, DOCX) analysiert die KI 
    automatisiert die Inhalte (z. B. die einleitenden Seiten) und generiert direkt passgenaue, maschinenlesbare Vorschläge 
    für Pflichtfelder wie Titel, Beschreibungen und Keywords. Der User muss diese nur noch überprüfen und bestätigen (human in the loop). 
    Das senkt den administrativen Aufwand massiv und sichert langfristig eine hohe, semantisch nutzbare Datenqualität.

## Systemarchitektur & Tech STack

* **Frontend:** React / Typescript
* **Backend:** Python?
* **LLM:** `TODO`
* **Embedding Model:** `TODO`
* **Vector Store:** `TODO`

## Setup & Installation (How-To)

```{commandline}
Hier beschreibt ihr in 1-2 Sätzen kurz, welche Voraussetzungen nötig sind (z.B. API-Keys, Node.js, Python-Version) und wie die Jury den Code lokal auf ihrem eigenen Rechner starten kann.
```

## Roadmap & Future Work

Unser MVP beweist, dass KI-gestützte Metadatengenerierung und hybride Suche die Nutzbarkeit von `data.gv.at` massiv 
verbessern können. Wenn wir das Projekt weiterentwickeln, stehen folgende Meilensteine im Fokus:

1. **Ausweitung Metadaten-Anreicherung:**
Aktuell fokussiert sich das Pre-Processing auf textbasierte Dokumente (PDF, DOCX). In Zukunft soll das System beliebige
Datensätze verarbeiten können – von strukturierten tabellarischen Daten (CSV, Excel) und Geodaten (GeoJSON) bis hin zu 
unstrukturierten Daten wie Bildern, Audio und Video.

2. **Skalierung auf Bestandsdaten (Human-in-the-loop):**
Während unser MVP primär beim Upload neuer Daten ansetzt, könnte das System im nächsten Schritt asynchron über die 
gesamten 68.000+ Bestandsdaten laufen, um fehlende Metadaten im Hintergrund mit KI anzureichern. Ein "Human-in-the-loop"-
Ansatz stellt dabei sicher, dass Verwaltungsmitarbeiter die KI-Vorschläge vor Veröffentlichung verifizieren.

3. **Lernendes Reranking & Caching:**
Implementierung eines User-Feedback-Loops direkt in der Suche ("War dieses Ergebnis hilfreich?"). Basierend auf diesem
impliziten und expliziten Feedback kann der Reranker kontinuierlich nachtrainiert und verbessert werden.