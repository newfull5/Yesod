-- Yesod schema v1 (PLAN.md section 3). Applied via PRAGMA user_version.

CREATE TABLE projects (
    id             INTEGER PRIMARY KEY,
    key_prefix     TEXT NOT NULL UNIQUE,          -- e.g. "YS" -> issue key "YS-1"
    name           TEXT NOT NULL,
    next_issue_num INTEGER NOT NULL DEFAULT 1     -- bumped in a transaction; numbers never reused
);

CREATE TABLE issue_types (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL,                           -- Story / Bug / Task / Epic (seeded)
    icon TEXT
);

CREATE TABLE statuses (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    name        TEXT NOT NULL,
    category    TEXT NOT NULL CHECK (category IN ('todo','in_progress','done')),
    board_order INTEGER NOT NULL                  -- board columns = rows of this table
);

CREATE TABLE people (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,                   -- not a login account; assignee/reporter choices
    avatar_color TEXT
);

CREATE TABLE teams (
    id   INTEGER PRIMARY KEY,
    name TEXT NOT NULL
);

CREATE TABLE sprints (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id),
    name       TEXT NOT NULL,
    start_date TEXT,
    end_date   TEXT,
    state      TEXT NOT NULL DEFAULT 'future' CHECK (state IN ('future','active','closed'))
);

CREATE TABLE issues (
    id          INTEGER PRIMARY KEY,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    key         TEXT NOT NULL UNIQUE,             -- "YS-42"
    title       TEXT NOT NULL,
    description TEXT,                             -- markdown
    type_id     INTEGER REFERENCES issue_types(id),
    status_id   INTEGER NOT NULL REFERENCES statuses(id),
    reporter_id INTEGER REFERENCES people(id),
    assignee_id INTEGER REFERENCES people(id),
    parent_id   INTEGER REFERENCES issues(id),    -- parent item / sub-task (self FK)
    team_id     INTEGER REFERENCES teams(id),
    start_date  TEXT,
    due_date    TEXT,
    board_order REAL,                             -- card order within a column (midpoint insert)
    archived_at TEXT,                             -- set by "clear done"; hidden from board, kept as history
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE issue_sprints (
    issue_id  INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    sprint_id INTEGER NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    PRIMARY KEY (issue_id, sprint_id)
);

CREATE TABLE issue_links (
    issue_id        INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    linked_issue_id INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    link_type       TEXT NOT NULL,                -- blocks / is blocked by / relates to
    PRIMARY KEY (issue_id, linked_issue_id, link_type)
);

CREATE TABLE comments (
    id         INTEGER PRIMARY KEY,
    issue_id   INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    author_id  INTEGER REFERENCES people(id),
    body       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE agent_jobs (
    id           INTEGER PRIMARY KEY,
    issue_id     INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    status       TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
    result       TEXT,                            -- short outcome note from the runner
    log          TEXT,                            -- progress log, appended by the runner
    requested_by TEXT,                            -- person name; runners filter on it in multi-user setups
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
