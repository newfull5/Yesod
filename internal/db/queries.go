package db

import (
	"database/sql"
	"fmt"
)

// AllocateIssueKey bumps projects.next_issue_num inside tx and returns the
// freshly allocated key, e.g. "YS-42". Numbers are never reused (Jira-like).
// The UPDATE runs first so the row is write-locked before we read the number.
func AllocateIssueKey(tx *sql.Tx, projectID int64) (string, error) {
	res, err := tx.Exec(`UPDATE projects SET next_issue_num = next_issue_num + 1 WHERE id = ?`, projectID)
	if err != nil {
		return "", err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return "", err
	}
	if n == 0 {
		return "", sql.ErrNoRows
	}
	var prefix string
	var num int64
	if err := tx.QueryRow(`SELECT key_prefix, next_issue_num - 1 FROM projects WHERE id = ?`, projectID).Scan(&prefix, &num); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%d", prefix, num), nil
}

// BottomBoardOrder returns a board_order value that places an issue at the
// bottom of the given status column (max + 1024, or 1024 for an empty column).
func BottomBoardOrder(q interface {
	QueryRow(query string, args ...any) *sql.Row
}, statusID int64) (float64, error) {
	var v float64
	err := q.QueryRow(`SELECT COALESCE(MAX(board_order), 0) + 1024 FROM issues WHERE status_id = ?`, statusID).Scan(&v)
	return v, err
}
