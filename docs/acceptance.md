# Acceptance

Scenarios for behaviour that is already agreed. Add the next step's scenarios here when that step is built. Steps that are not listed are not in this file yet.

```gherkin
Feature: Sign in

  The app is "My AI Journal". Sign-in is the only screen available without a stored session.
  There is no sign-up.

  Scenario: A new launch opens on sign-in
    Given the phone has no stored session
    When the app finishes reading the keychain
    Then the sign-in screen is shown
    And the notes are not shown

  Scenario: Sign-in needs both fields
    Given the sign-in screen is shown
    When the email or the password is empty
    And Sign in is tapped
    Then the app stays on sign-in
    And it says "Email and password are required."

  Scenario: A stored session opens the notes
    Given a session is stored on the phone
    When the app finishes reading the keychain
    Then the notes screen is shown
    And its title is "My AI Journal"

  Scenario: Sign out returns to sign-in
    Given the notes screen is shown
    When Sign out is tapped
    Then the sign-in screen is shown
    And the notes are not shown
```

```gherkin
Feature: Notes home

  After sign-in the notes are home. Write and Ask sit above the list.

  Background:
    Given a session is stored
    And the notes screen is shown

  Scenario: An empty journal still offers Write and Ask
    Given no notes are stored
    Then the list says "No entries yet"
    And Write and Ask are shown

  Scenario: Write opens a new note
    When Write is tapped
    Then the editor is shown
    And it is a new note, so Delete is not shown

  Scenario: Ask opens the question screen
    When Ask is tapped
    Then the Ask screen is shown
    And it has a question field
```

```gherkin
Feature: Save a note

  The editor shows an optional title, then the date, the body, the tags, and Save.
  The tags are life, work, thoughts, and learnings. A note may have several, or none.
  The title is not a tag.

  Background:
    Given a session is stored
    And Write is open

  Scenario: A new note starts with today and an empty title
    Then the title field is empty
    And the date field is today, shown as YYYY-MM-DD
    And the body is empty

  Scenario: A note needs a body
    Given the body is empty
    When Save is tapped
    Then the editor stays open
    And it says "A note needs a body."
    And the list is unchanged

  Scenario: The date must be a day
    Given the body is "Walked home"
    And the date is "tomorrow"
    When Save is tapped
    Then the editor stays open
    And it says "Date must be YYYYMMDD."

  Scenario Outline: Saving returns to the list
    Given the title is "<title>"
    And the body is "<body>"
    And the date is "2026-10-01"
    And the selected tags are "<tags>"
    When Save is tapped
    Then the notes screen is shown
    And the new row shows "1 Oct"
    And the new row shows "<label>"
    And the new row shows "<tags>"
    And the new row says "On the phone"

    Examples:
      | title                | body                         | tags             | label                        |
      | Blue paper lantern   | It sat on the kitchen table. | thoughts         | Blue paper lantern           |
      |                      | Walked home the long way.    | life, work       | Walked home the long way.    |
      |                      | First line\nSecond line.     |                  | First line                   |
```

```gherkin
Feature: Edit a note

  Opening a row edits that note. Save replaces it.

  Background:
    Given a session is stored
    And a note exists with title "Lantern", date "2026-10-01", body "On the table.", and tag "thoughts"

  Scenario: The editor shows the saved note
    When that note's row is tapped
    Then the title is "Lantern"
    And the date is "2026-10-01"
    And the body is "On the table."
    And "thoughts" is selected
    And Delete is shown

  Scenario: Save replaces the note
    Given that note is open
    When the title is changed to "Paper lantern"
    And the body is changed to "Moved to the window."
    And Save is tapped
    Then the notes screen is shown
    And the row shows "Paper lantern"
    And the row says "On the phone"
```

```gherkin
Feature: Delete a note

  Delete removes the note from the list immediately.

  Background:
    Given a session is stored

  Scenario: Delete removes the row
    Given a note exists with body "On the table."
    When that note is opened
    And Delete is tapped
    Then the notes screen is shown
    And that note is not in the list

  Scenario: The last note leaves an empty list
    Given that note was the only one
    When it is deleted
    Then the list says "No entries yet"
    And Write and Ask are still shown
```

```gherkin
Feature: Notes stay on the phone

  Sign-out hides the notes and leaves the SQLite file in place.

  Scenario: Signing in again shows the same notes
    Given a note is stored
    And the session is cleared by Sign out
    When the same session is stored again
    Then that note is in the list

  Scenario: A later launch with a session shows the notes
    Given a note is stored
    And a session is stored
    When the app is opened again
    Then that note is in the list

  Scenario: A later launch without a session stays on sign-in
    Given a note is stored
    And the phone has no stored session
    When the app is opened again
    Then the sign-in screen is shown
    And the notes are not shown
```

```gherkin
Feature: Filter notes by tag

  The tag chips are All, life, work, thoughts, and learnings.
  A note appears under All and under each tag it has. A note with no tags appears only under All.
  Write and Ask stay above the list.

  Background:
    Given a session is stored
    And the notes screen is shown
    And a note tagged "work" exists
    And a note tagged "life" and "work" exists
    And a note with no tags exists

  Scenario: All shows every note
    When All is selected
    Then all three notes are in the list
    And Write and Ask are shown

  Scenario: A tag shows only its notes
    When "work" is selected
    Then the two work notes are in the list
    And the note with no tags is not in the list

  Scenario: A tag with no notes is empty
    When "thoughts" is selected
    Then the list says "No notes for this tag"
    And Write and Ask are shown

  Scenario: An empty journal says there are no entries
    Given no notes are stored
    When All is selected
    Then the list says "No entries yet"
    And Write and Ask are shown
```
