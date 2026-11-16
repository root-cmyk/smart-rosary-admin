
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { db } from "./firebase/config";

import "./UsersPanel.css";

const FILTERS = [
  { value: "all", label: "All users" },
  { value: "parent", label: "Parents" },
  { value: "independentChild", label: "Independent children" },
  { value: "parentManagedChild", label: "Parent-managed children" },
];

const EMPTY_FORM = {
  name: "",
  username: "",
};

function toDateLabel(value) {
  if (!value) return "—";

  const date =
    typeof value?.toDate === "function"
      ? value.toDate()
      : value instanceof Date
        ? value
        : null;

  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
}

function displayName(record) {
  return (
    record.name ||
    record.displayName ||
    record.username ||
    record.email ||
    "Unnamed user"
  );
}

function getAccountTypeLabel(type) {
  if (type === "parent") return "Parent";
  if (type === "independentChild") return "Independent child";
  return "Parent-managed child";
}

export default function UsersPanel() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [lastUpdated, setLastUpdated] = useState(null);

  const [editingRecord, setEditingRecord] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deletingRowId, setDeletingRowId] = useState("");

  // --------------------------------
  // LOAD USERS FROM FIRESTORE
  // --------------------------------

  const loadUsers = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    setError("");

    try {
      // Load parent and independent child accounts.
      const usersSnapshot = await getDocs(
        collection(db, "users")
      );

      const userDocs = usersSnapshot.docs.map((item) => ({
        id: item.id,
        ...item.data(),
      }));

      const parentById = new Map(
        userDocs
          .filter((item) => item.accountType === "parent")
          .map((item) => [item.id, item])
      );

      const accountRows = userDocs
        .filter(
          (item) =>
            item.accountType === "parent" ||
            item.accountType === "independentChild"
        )
        .map((item) => ({
          id: item.id,
          rowId: `account-${item.id}`,
          type: item.accountType,
          name: displayName(item),
          email: item.email || "",
          username: item.username || "",
          parentName: "",
          parentEmail: "",
          parentUid: "",
          createdAt: item.createdAt || null,
        }));

      // Load parent-managed child profiles.
      const kidsSnapshot = await getDocs(
        collectionGroup(db, "kids")
      );

      const childRows = kidsSnapshot.docs.map((item) => {
        const data = item.data();

        const parentUid =
          data.parentUid ||
          item.ref.parent.parent?.id ||
          "";

        const parent = parentById.get(parentUid);

        return {
          id: item.id,
          rowId: `managed-${parentUid}-${item.id}`,
          type: "parentManagedChild",
          name: displayName(data),
          email: data.loginEmail || "",
          username: data.username || "",
          parentUid,
          parentName: parent
            ? displayName(parent)
            : "Parent account",
          parentEmail: parent?.email || "",
          createdAt: data.createdAt || null,
        };
      });

      const combined = [...accountRows, ...childRows].sort(
        (a, b) => {
          const aDate = a.createdAt?.toMillis?.() || 0;
          const bDate = b.createdAt?.toMillis?.() || 0;

          return bDate - aDate;
        }
      );

      setRecords(combined);
      setLastUpdated(new Date());

    } catch (loadError) {
      console.error("Loading users failed:", loadError);

      setError(
        loadError.code === "permission-denied"
          ? "Access denied. Check your Firestore rules and administrator permissions."
          : loadError.message || "Unable to load user records."
      );

    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // --------------------------------
  // USER STATISTICS
  // --------------------------------

  const counts = useMemo(
    () => ({
      all: records.length,

      parent: records.filter(
        (item) => item.type === "parent"
      ).length,

      independentChild: records.filter(
        (item) => item.type === "independentChild"
      ).length,

      parentManagedChild: records.filter(
        (item) => item.type === "parentManagedChild"
      ).length,
    }),
    [records]
  );

  // --------------------------------
  // SEARCH AND FILTER
  // --------------------------------

  const visibleRecords = useMemo(() => {
    const term = search.trim().toLowerCase();

    return records.filter((item) => {
      const matchesType =
        filter === "all" || item.type === filter;

      const searchable = [
        item.name,
        item.email,
        item.username,
        item.parentName,
        item.parentEmail,
        item.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return matchesType && (!term || searchable.includes(term));
    });
  }, [records, search, filter]);

  // --------------------------------
  // OPEN EDIT FORM
  // --------------------------------

  const openEdit = (record) => {
    setNotice("");
    setError("");

    setEditingRecord(record);

    setEditForm({
      name: record.name === "Unnamed user" ? "" : record.name,
      username: record.username || "",
    });
  };

  const closeEdit = () => {
    if (saving) return;

    setEditingRecord(null);
    setEditForm(EMPTY_FORM);
  };

  // --------------------------------
  // UPDATE USER PROFILE
  // --------------------------------

  const saveEdit = async (event) => {
    event.preventDefault();

    if (!editingRecord) return;

    const name = editForm.name.trim();
    const username = editForm.username
      .trim()
      .replace(/^@/, "");

    if (!name) {
      setError("Please enter a name.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      if (editingRecord.type === "parentManagedChild") {
        // Update a parent-managed child profile.
        const childRef = doc(
          db,
          "users",
          editingRecord.parentUid,
          "kids",
          editingRecord.id
        );

        await updateDoc(childRef, {
          name,
          username,
          updatedAt: serverTimestamp(),
        });

      } else {
        // Update a parent or independent child profile.
        const userRef = doc(
          db,
          "users",
          editingRecord.id
        );

        await updateDoc(userRef, {
          name,
          displayName: name,
          username,
          updatedAt: serverTimestamp(),
        });
      }

      setEditingRecord(null);
      setEditForm(EMPTY_FORM);

      setNotice(
        `${getAccountTypeLabel(editingRecord.type)} profile updated successfully.`
      );

      await loadUsers(true);

    } catch (saveError) {
      console.error("Updating user failed:", saveError);

      setError(
        saveError.code === "permission-denied"
          ? "Permission denied. Check the admin update rules in Firestore."
          : saveError.message || "Unable to update this profile."
      );

    } finally {
      setSaving(false);
    }
  };

  // --------------------------------
  // DELETE USER PROFILE
  // --------------------------------

  const deleteRecord = async (record) => {
    const isParent = record.type === "parent";
    const isManagedChild =
      record.type === "parentManagedChild";

    const description = isParent
      ? `Delete parent profile "${record.name}"?`
      : isManagedChild
        ? `Delete parent-managed child profile "${record.name}"?`
        : `Delete independent child profile "${record.name}"?`;

    const confirmed = window.confirm(
      `${description}\n\nThis deletes the Firestore profile document only. It does NOT delete the Firebase Authentication account or automatically remove stored progress.\n\nContinue?`
    );

    if (!confirmed) return;

    setDeletingRowId(record.rowId);
    setError("");
    setNotice("");

    try {
      let userRef;

      if (isManagedChild) {
        // Delete parent-managed child profile.
        userRef = doc(
          db,
          "users",
          record.parentUid,
          "kids",
          record.id
        );

      } else {
        // Delete parent or independent child profile.
        userRef = doc(
          db,
          "users",
          record.id
        );

        // Do not delete a parent while child profiles exist.
        if (isParent) {
          const kidsSnapshot = await getDocs(
            collection(db, "users", record.id, "kids")
          );

          if (!kidsSnapshot.empty) {
            throw new Error(
              "This parent still has child profiles. Delete those child profiles first."
            );
          }
        }
      }

      // Direct Firestore deletion.
      await deleteDoc(userRef);

      setNotice(
        `${getAccountTypeLabel(record.type)} profile deleted successfully.`
      );

      await loadUsers(true);

    } catch (deleteError) {
      console.error("Deleting user failed:", deleteError);

      setError(
        deleteError.code === "permission-denied"
          ? "Permission denied. Check your Firestore rules and confirm that you are signed in as an enabled administrator."
          : deleteError.message || "Unable to delete this profile."
      );

    } finally {
      setDeletingRowId("");
    }
  };

  // --------------------------------
  // USER INTERFACE
  // --------------------------------

  return (
    <section className="content-card users-panel">

      <div className="section-heading users-heading">
        <div>
          <h3>Registered users</h3>

          <p>
            View and manage parent accounts, independent child
            accounts and child profiles managed by parents.
          </p>
        </div>

        <button
          type="button"
          className="secondary-btn"
          onClick={() => loadUsers(true)}
          disabled={
            loading ||
            refreshing ||
            Boolean(deletingRowId) ||
            saving
          }
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </div>

      {/* USER STATISTICS */}

      <div className="users-stats">

        <article className="users-stat">
          <span>Total records</span>
          <strong>{loading ? "…" : counts.all}</strong>
        </article>

        <article className="users-stat">
          <span>Parent accounts</span>
          <strong>{loading ? "…" : counts.parent}</strong>
        </article>

        <article className="users-stat">
          <span>Independent children</span>
          <strong>
            {loading ? "…" : counts.independentChild}
          </strong>
        </article>

        <article className="users-stat">
          <span>Parent-managed profiles</span>
          <strong>
            {loading ? "…" : counts.parentManagedChild}
          </strong>
        </article>

      </div>

      {/* SEARCH AND FILTER */}

      <div className="users-toolbar">

        <label className="users-search">
          <span>Search users</span>

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, email, username or parent…"
          />
        </label>

        <label className="users-filter">
          <span>Account type</span>

          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {FILTERS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

      </div>

      {/* ERROR AND SUCCESS MESSAGES */}

      {error && (
        <div className="users-error" role="alert">
          {error}
        </div>
      )}

      {notice && (
        <div className="users-success" role="status">
          {notice}
        </div>
      )}

      {/* USERS TABLE */}

      {loading ? (
        <p className="notice">
          Loading user records from Firestore…
        </p>

      ) : visibleRecords.length === 0 ? (
        <p className="notice">
          {records.length === 0
            ? "No user records were found."
            : "No users match your search and filter."}
        </p>

      ) : (
        <div className="table-wrap users-table-wrap">

          <table className="users-table">

            <thead>
              <tr>
                <th>USER</th>
                <th>ACCOUNT TYPE</th>
                <th>EMAIL / USERNAME</th>
                <th>PARENT ACCOUNT</th>
                <th>REGISTERED</th>
                <th className="users-actions-heading">
                  ACTIONS
                </th>
              </tr>
            </thead>

            <tbody>
              {visibleRecords.map((item) => (

                <tr key={item.rowId}>

                  <td>
                    <strong>{item.name}</strong>

                    <small className="users-id">
                      ID: {item.id}
                    </small>
                  </td>

                  <td>
                    <span
                      className={`users-type users-type-${item.type}`}
                    >
                      {getAccountTypeLabel(item.type)}
                    </span>
                  </td>

                  <td>
                    <span>{item.email || "—"}</span>

                    {item.username && (
                      <small className="users-muted">
                        @{item.username.replace(/^@/, "")}
                      </small>
                    )}
                  </td>

                  <td>
                    {item.type === "parentManagedChild" ? (
                      <>
                        <strong>{item.parentName}</strong>

                        {item.parentEmail && (
                          <small className="users-muted">
                            {item.parentEmail}
                          </small>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>

                  <td>{toDateLabel(item.createdAt)}</td>

                  <td>
                    <div className="users-row-actions">

                      <button
                        type="button"
                        className="users-edit-btn"
                        onClick={() => openEdit(item)}
                        disabled={
                          Boolean(deletingRowId) || saving
                        }
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        className="users-delete-btn"
                        onClick={() => deleteRecord(item)}
                        disabled={
                          Boolean(deletingRowId) || saving
                        }
                      >
                        {deletingRowId === item.rowId
                          ? "Deleting…"
                          : "Delete"}
                      </button>

                    </div>
                  </td>

                </tr>
              ))}
            </tbody>

          </table>
        </div>
      )}

      {/* TABLE FOOTER */}

      <div className="users-footer">
        <span>
          Showing {visibleRecords.length} of {records.length} records
        </span>

        {lastUpdated && (
          <span>
            Last refreshed: {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      <p className="notice users-readonly-note">
        Profile changes are saved directly to Firestore.
        Email addresses and Firebase Authentication credentials
        are not modified by this panel.
      </p>

      {/* EDIT MODAL */}

      {editingRecord && (

        <div
          className="users-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEdit();
            }
          }}
        >

          <section
            className="users-edit-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="users-edit-title"
          >

            <div className="users-modal-heading">

              <div>
                <h3 id="users-edit-title">
                  Edit user
                </h3>

                <p>
                  {getAccountTypeLabel(editingRecord.type)}
                </p>
              </div>

              <button
                type="button"
                className="users-modal-close"
                onClick={closeEdit}
                disabled={saving}
                aria-label="Close edit form"
              >
                ×
              </button>

            </div>

            <form onSubmit={saveEdit}>

              <label>
                <span>Name</span>

                <input
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                  maxLength={100}
                />
              </label>

              <label>
                <span>Email address (read only)</span>

                <input
                  value={editingRecord.email || "No email"}
                  disabled
                  readOnly
                />
              </label>

              <label>
                <span>Username</span>

                <input
                  value={editForm.username}
                  onChange={(event) =>
                    setEditForm((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                  maxLength={40}
                />
              </label>

              <p className="users-modal-hint">
                Account ID, email, account type and parent
                association cannot be changed from this form.
              </p>

              <div className="users-modal-actions">

                <button
                  type="button"
                  className="users-cancel-btn"
                  onClick={closeEdit}
                  disabled={saving}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="users-save-btn"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save changes"}
                </button>

              </div>

            </form>

          </section>
        </div>
      )}

    </section>
  );
}
