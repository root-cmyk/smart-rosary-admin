import { useEffect, useState } from "react";

import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { db } from "./firebase/config";

import "./KidsContentManager.css";

const panels = {
  lessons: {
    title: "Kids Lessons",
    collection: "kidsModules",
  },
  stories: {
    title: "Bible Stories",
    collection: "kidsStories",
  },
  guided: {
    title: "Guided Rosary",
    collection: "kidsGuidedSessions",
  },
  stickers: {
    title: "Stickers & Rewards",
    collection: "kidsStickers",
  },
};

const blank = {
  title: "",
  name: "",
  description: "",
  content: "",
  storyText: "",
  activity: "",
  intro: "",
  completionMessage: "",
  mysteryType: "Joyful",
  imageUrl: "",
  language: "English",
  order: 1,
  published: false,
  prayerIds: [],
  stickerIds: [],
  unlockType: "prayers_completed",
  unlockValue: 1,
};

const languages = ["English", "Luganda", "Runyankole", "Swahili"];

export default function KidsContentManager() {
  const [active, setActive] = useState("lessons");
  const [records, setRecords] = useState({
    lessons: [],
    stories: [],
    guided: [],
    stickers: [],
  });
  const [prayers, setPrayers] = useState([]);

  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...blank });
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("info");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let activeSubscriptions = 0;
    let failed = false;

    const subscriptions = Object.entries(panels).map(([key, panel]) => {
      activeSubscriptions++;

      return onSnapshot(
        query(
          collection(db, panel.collection),
          orderBy("order", "asc")
        ),
        (snapshot) => {
          setRecords((previous) => ({
            ...previous,
            [key]: snapshot.docs.map((item) => ({
              id: item.id,
              ...item.data(),
            })),
          }));

          activeSubscriptions--;
          if (activeSubscriptions === 0 && !failed) {
            setLoading(false);
          }
        },
        (error) => {
          console.error(`Loading ${panel.collection} failed:`, error);
          failed = true;
          setLoading(false);
          showMessage(
            `Could not load ${panel.title}: ${error.message}`,
            "error"
          );
        }
      );
    });

    const prayerSubscription = onSnapshot(
      query(
        collection(db, "prayers"),
        where("published", "==", true)
      ),
      (snapshot) => {
        const publishedPrayers = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));

        publishedPrayers.sort((a, b) =>
          (a.title || "").localeCompare(b.title || "")
        );

        setPrayers(publishedPrayers);
      },
      (error) => {
        console.error("Loading published prayers failed:", error);
        showMessage(
          `Could not load published prayers: ${error.message}`,
          "error"
        );
      }
    );

    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      prayerSubscription();
    };
  }, []);

  function showMessage(text, type = "success") {
    setMessage(text);
    setMessageType(type);
  }

  const items = records[active] || [];
  const panel = panels[active];

  function field(name, value) {
    setForm((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  function createNew() {
    setEditing("new");
    setForm({
      ...blank,
      order: items.length + 1,
    });
    setMessage("");
  }

  function edit(item) {
    setEditing(item.id);
    setForm({
      ...blank,
      ...item,
      prayerIds: Array.isArray(item.prayerIds) ? item.prayerIds : [],
      stickerIds: Array.isArray(item.stickerIds) ? item.stickerIds : [],
    });
    setMessage("");
  }

  function changeTab(key) {
    setActive(key);
    setEditing(null);
    setForm({ ...blank });
    setMessage("");
  }

  function toggleId(key, id) {
    const current = form[key] || [];

    field(
      key,
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );
  }

  async function save(event) {
    event.preventDefault();

    const label =
      active === "stickers"
        ? form.name.trim()
        : form.title.trim();

    if (!label) {
      showMessage(
        active === "stickers"
          ? "A sticker name is required."
          : "A title is required.",
        "error"
      );
      return;
    }

    if (active === "guided" && !form.prayerIds.length) {
      showMessage(
        "Select at least one published prayer for this guided session.",
        "error"
      );
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      const data = {
        ...form,
        order: Math.max(1, Number(form.order) || 1),
        unlockValue: Math.max(1, Number(form.unlockValue) || 1),
        updatedAt: serverTimestamp(),
      };

      if (editing === "new") {
        await addDoc(collection(db, panel.collection), {
          ...data,
          createdAt: serverTimestamp(),
        });

        showMessage("Content created successfully.");
      } else {
        await setDoc(
          doc(db, panel.collection, editing),
          data,
          { merge: true }
        );

        showMessage("Content updated successfully.");
      }

      setEditing(null);
      setForm({ ...blank });
    } catch (error) {
      console.error("Saving Kids content failed:", error);
      showMessage(`Save failed: ${error.message}`, "error");
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish(item) {
    try {
      await setDoc(
        doc(db, panel.collection, item.id),
        {
          published: !item.published,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      showMessage(
        item.published
          ? "Content moved to drafts."
          : "Content published successfully."
      );
    } catch (error) {
      console.error("Publishing content failed:", error);
      showMessage(error.message, "error");
    }
  }

  async function remove(item) {
    const confirmed = window.confirm(
      `Delete "${item.title || item.name}" permanently? This cannot be undone.`
    );

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, panel.collection, item.id));

      if (editing === item.id) {
        setEditing(null);
        setForm({ ...blank });
      }

      showMessage("Content deleted successfully.");
    } catch (error) {
      console.error("Deleting content failed:", error);
      showMessage(error.message, "error");
    }
  }

  function input(label, name, options = {}) {
    return (
      <label className="kc-field" key={name}>
        <span>{label}</span>

        {options.multiline ? (
          <textarea
            rows={options.rows || 4}
            value={form[name] ?? ""}
            required={options.required || false}
            onChange={(event) => field(name, event.target.value)}
            placeholder={options.placeholder || ""}
          />
        ) : (
          <input
            type={options.type || "text"}
            min={options.type === "number" ? 1 : undefined}
            value={form[name] ?? ""}
            required={options.required || false}
            onChange={(event) => field(name, event.target.value)}
            placeholder={options.placeholder || ""}
          />
        )}
      </label>
    );
  }

  return (
    <section className="kc">
      <header className="kc-header">
        <div>
          <small>SMART ROSARY / CONTENT STUDIO</small>
          <h1>Kids Mode Management</h1>
          <p>
            Manage lessons, Bible stories, guided Rosaries and rewards
            displayed in Kids Mode.
          </p>
        </div>

        <button
          type="button"
          className="kc-primary"
          onClick={createNew}
        >
          + Add Content
        </button>
      </header>

      <nav className="kc-tabs">
        {Object.entries(panels).map(([key, item]) => (
          <button
            type="button"
            key={key}
            className={active === key ? "selected" : ""}
            onClick={() => changeTab(key)}
          >
            {item.title}
            <span>{(records[key] || []).length}</span>
          </button>
        ))}
      </nav>

      {message && (
        <div className={`kc-message ${messageType}`}>
          {message}
        </div>
      )}

      <div className="kc-layout">
        <div className="kc-library">
          <div className="kc-library-heading">
            <div>
              <h2>{panel.title}</h2>
              <p>{items.length} content records</p>
            </div>
          </div>

          {loading ? (
            <div className="kc-empty">
              <div className="kc-loader" />
              <p>Loading Kids content...</p>
            </div>
          ) : items.length === 0 ? (
            <div className="kc-empty">
              <span className="kc-empty-icon">✦</span>
              <h3>No content yet</h3>
              <p>
                Add your first {panel.title.toLowerCase()} record.
              </p>
              <button
                type="button"
                className="kc-primary"
                onClick={createNew}
              >
                + Create first record
              </button>
            </div>
          ) : (
            <div className="kc-items">
              {items.map((item) => (
                <article className="kc-item" key={item.id}>
                  {item.imageUrl ? (
                    <img
                      className="kc-item-image"
                      src={item.imageUrl}
                      alt=""
                      onError={(event) => {
                        event.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <div className="kc-item-placeholder">✦</div>
                  )}

                  <div className="kc-item-info">
                    <strong>{item.title || item.name}</strong>

                    <small>
                      {item.language || "English"} · Order{" "}
                      {item.order || 1}
                    </small>

                    <span className={item.published ? "live" : "draft"}>
                      {item.published ? "Published" : "Draft"}
                    </span>
                  </div>

                  <div className="kc-item-actions">
                    <button
                      type="button"
                      onClick={() => edit(item)}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => togglePublish(item)}
                    >
                      {item.published ? "Unpublish" : "Publish"}
                    </button>

                    <button
                      type="button"
                      className="kc-delete"
                      onClick={() => remove(item)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {editing && (
          <form className="kc-editor" onSubmit={save}>
            <div className="kc-editor-heading">
              <div>
                <small>CONTENT EDITOR</small>
                <h2>
                  {editing === "new" ? "Create Content" : "Edit Content"}
                </h2>
              </div>

              <button
                type="button"
                className="kc-close"
                onClick={() => setEditing(null)}
                aria-label="Close editor"
              >
                ×
              </button>
            </div>

            {active === "stickers"
              ? input("Sticker name", "name", { required: true })
              : input("Title", "title", { required: true })}

            {input("Description", "description")}
            {input("Artwork image URL", "imageUrl", {
              placeholder: "https://example.com/image.png",
            })}

            {active === "lessons" && (
              <>
                <div className="kc-section-label">LESSON CONTENT</div>
                {input("Teaching content", "content", {
                  multiline: true,
                  rows: 8,
                  required: true,
                })}
              </>
            )}

            {active === "stories" && (
              <>
                <div className="kc-section-label">BIBLE STORY</div>

                {input("Story text", "storyText", {
                  multiline: true,
                  rows: 9,
                  required: true,
                })}

                {input("Learning activity", "activity", {
                  multiline: true,
                  rows: 4,
                })}

                <div className="kc-section-label">REWARD STICKERS</div>

                {records.stickers.length === 0 ? (
                  <p className="kc-hint">
                    Create stickers first to assign them to this story.
                  </p>
                ) : (
                  records.stickers.map((sticker) => (
                    <label className="kc-check" key={sticker.id}>
                      <input
                        type="checkbox"
                        checked={(form.stickerIds || []).includes(sticker.id)}
                        onChange={() =>
                          toggleId("stickerIds", sticker.id)
                        }
                      />
                      <span>{sticker.name}</span>
                    </label>
                  ))
                )}
              </>
            )}

            {active === "guided" && (
              <>
                <div className="kc-section-label">GUIDED ROSARY</div>

                {input("Session introduction", "intro", {
                  multiline: true,
                  rows: 4,
                })}

                <label className="kc-field">
                  <span>Mystery set</span>
                  <select
                    value={form.mysteryType}
                    onChange={(event) =>
                      field("mysteryType", event.target.value)
                    }
                  >
                    {[
                      "Joyful",
                      "Sorrowful",
                      "Glorious",
                      "Luminous",
                      "Custom",
                    ].map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="kc-section-label">PRAYER SEQUENCE</div>

                <p className="kc-hint">
                  Select the published prayers to include in this
                  session. These reuse your existing prayer records
                  and their audio.
                </p>

                {prayers.length === 0 ? (
                  <p className="kc-warning">
                    No published prayers found. Publish prayers in
                    Prayer Management first.
                  </p>
                ) : (
                  prayers.map((prayer) => (
                    <label className="kc-check" key={prayer.id}>
                      <input
                        type="checkbox"
                        checked={(form.prayerIds || []).includes(prayer.id)}
                        onChange={() =>
                          toggleId("prayerIds", prayer.id)
                        }
                      />
                      <span>
                        {prayer.title} · {prayer.category || "Prayer"}
                      </span>
                    </label>
                  ))
                )}

                {input("Completion message", "completionMessage", {
                  multiline: true,
                  rows: 3,
                })}
              </>
            )}

            {active === "stickers" && (
              <>
                <div className="kc-section-label">UNLOCK SETTINGS</div>

                <label className="kc-field">
                  <span>Unlock condition</span>
                  <select
                    value={form.unlockType}
                    onChange={(event) =>
                      field("unlockType", event.target.value)
                    }
                  >
                    <option value="prayers_completed">
                      Prayers completed
                    </option>
                    <option value="lessons_completed">
                      Lessons completed
                    </option>
                    <option value="guided_sessions_completed">
                      Guided Rosaries completed
                    </option>
                    <option value="stories_completed">
                      Stories completed
                    </option>
                    <option value="manual">
                      Parent awards manually
                    </option>
                  </select>
                </label>

                {input("Required count", "unlockValue", {
                  type: "number",
                })}
              </>
            )}

            <div className="kc-section-label">DISPLAY SETTINGS</div>

            <div className="kc-row">
              <label className="kc-field">
                <span>Language</span>
                <select
                  value={form.language}
                  onChange={(event) =>
                    field("language", event.target.value)
                  }
                >
                  {languages.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>

              {input("Display order", "order", {
                type: "number",
              })}
            </div>

            <label className="kc-publish">
              <input
                type="checkbox"
                checked={!!form.published}
                onChange={(event) =>
                  field("published", event.target.checked)
                }
              />
              <span>
                <strong>Publish this content</strong>
                <small>Make it available in Kids Mode.</small>
              </span>
            </label>

            <div className="kc-actions">
              <button
                type="button"
                className="kc-secondary"
                onClick={() => setEditing(null)}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="kc-primary"
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Content"}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
