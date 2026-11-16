import KidsContentManager from "./KidsContentManager";
import UsersPanel from "./UsersPanel";

import { useEffect, useState } from "react";

import { onAuthStateChanged, signOut } from "firebase/auth";

import {

  addDoc,

  collection,

  deleteDoc,

  doc,

  onSnapshot,

  serverTimestamp,

  updateDoc,

} from "firebase/firestore";

import { auth, db } from "./firebase/config";

import Login from "./login";

const categories = [

  "Basic Prayers",

  "Rosary Mysteries",

  "Marian Prayers",

  "Other Prayers",

];

const languages = ["English", "Luganda", "Runyankole", "Swahili"];

const emptyPrayer = {

  title: "",

  text: "",

  category: "Basic Prayers",

  language: "English",

};

export default function App() {

  const [user, setUser] = useState(null);

  const [authReady, setAuthReady] = useState(false);

  const [activeTab, setActiveTab] = useState("Overview");

  const [prayers, setPrayers] = useState([]);

  const [showForm, setShowForm] = useState(false);

  const [editingPrayerId, setEditingPrayerId] = useState(null);

  const [formData, setFormData] = useState(emptyPrayer);

  const [loadingPrayers, setLoadingPrayers] = useState(true);

  const [savingPrayer, setSavingPrayer] = useState(false);

  const [deletingPrayerId, setDeletingPrayerId] = useState(null);

  const [prayerError, setPrayerError] = useState("");

  const [signOutError, setSignOutError] = useState("");

  const [notice, setNotice] = useState("");

  const [viewingPrayer, setViewingPrayer] = useState(null);

  //  * Audio management.*

  const [selectedPrayerId, setSelectedPrayerId] = useState("");

  const [audioFile, setAudioFile] = useState(null);

  const [uploadingAudio, setUploadingAudio] = useState(false);

  function updateForm(field, value) {

    setFormData((current) => ({

      ...current,

      [field]: value,

    }));

  }

  function resetForm() {

    setFormData({ ...emptyPrayer });

    setEditingPrayerId(null);

    setShowForm(false);

  }

  function openNewPrayerForm() {

    setPrayerError("");

    setNotice("");

    setViewingPrayer(null);

    setFormData({ ...emptyPrayer });

    setEditingPrayerId(null);

    setShowForm(true);

    setActiveTab("Prayers");

  }

  function openEditForm(prayer) {

    setPrayerError("");

    setNotice("");

    setViewingPrayer(null);

    setFormData({

      title: prayer.title || "",

      text: prayer.text || "",

      category: prayer.category || "Basic Prayers",

      language: prayer.language || "English",

    });

    setEditingPrayerId(prayer.id);

    setShowForm(true);

    setActiveTab("Prayers");

  }

  // *// Firebase authentication.*

  useEffect(() => {

    const unsubscribe = onAuthStateChanged(

      auth,

      (currentUser) => {

        setUser(currentUser);

        setAuthReady(true);

      },

      (error) => {

        console.error("Authentication error:", error);

        setAuthReady(true);

      }

    );

    return unsubscribe;

  }, []);

  // *// Real-time Firestore prayer list.*

  useEffect(() => {

    if (!authReady) return;

    if (!user) {

      setPrayers([]);

      setLoadingPrayers(false);

      return;

    }

    setLoadingPrayers(true);

    setPrayerError("");

    const unsubscribe = onSnapshot(

      collection(db, "prayers"),

      (snapshot) => {

        const records = snapshot.docs.map((item) => ({

          id: item.id,

          ...item.data(),

        }));

        records.sort((a, b) => {

          const aTime = a.createdAt?.seconds ?? 0;

          const bTime = b.createdAt?.seconds ?? 0;

          return bTime - aTime;

        });

        setPrayers(records);

        setLoadingPrayers(false);

      },

      (error) => {

        console.error("Loading prayers failed:", error);

        setPrayerError(

          error.code === "permission-denied"

            ? "Access denied. Check your admin UID and Firestore security rules."

            : "Unable to load prayers. Check your connection and Firebase configuration."

        );

        setLoadingPrayers(false);

      }

    );

    return unsubscribe;

  }, [user, authReady]);

  async function handleSignOut() {

    setSignOutError("");

    try {

      await signOut(auth);

      setActiveTab("Overview");

    } catch (error) {

      console.error("Sign-out failed:", error);

      setSignOutError("Unable to sign out. Please try again.");

    }

  }

  // * CREATE and UPDATE.*

  async function savePrayer(event) {

    event.preventDefault();

    const title = formData.title.trim();

    const text = formData.text.trim();

    if (!title || !text) {

      setPrayerError("Enter both the prayer title and the full prayer text.");

      return;

    }

    setSavingPrayer(true);

    setPrayerError("");

    setNotice("");

    try {

      const prayerData = {

        title,

        text,

        category: formData.category,

        language: formData.language,

        updatedAt: serverTimestamp(),

      };

      if (editingPrayerId) {

        await updateDoc(doc(db, "prayers", editingPrayerId), prayerData);

        setNotice(`"${title}" was updated successfully.`);

      } else {

        await addDoc(collection(db, "prayers"), {

          ...prayerData,

          published: false,

          createdAt: serverTimestamp(),

        });

        setNotice(`"${title}" was saved as a draft.`);

      }

      resetForm();

    } catch (error) {

      console.error("Saving prayer failed:", error);

      setPrayerError(

        error.code === "permission-denied"

          ? "Permission denied. Check your admin account and Firestore rules."

          : "Could not save the prayer. Please try again."

      );

    } finally {

      setSavingPrayer(false);

    }

  }

  //  DELETE.*

  async function deletePrayer(prayer) {

    const confirmed = window.confirm(

      `Permanently delete "${prayer.title}"?\n\nThis will remove its Firestore record. This action cannot be undone.`

    );

    if (!confirmed) return;

    setDeletingPrayerId(prayer.id);

    setPrayerError("");

    setNotice("");

    try {

      await deleteDoc(doc(db, "prayers", prayer.id));

      if (editingPrayerId === prayer.id) {

        resetForm();

      }

      if (viewingPrayer?.id === prayer.id) {

        setViewingPrayer(null);

      }

      if (selectedPrayerId === prayer.id) {

        setSelectedPrayerId("");

      }

      setNotice(`"${prayer.title}" was deleted from Firestore.`);

    } catch (error) {

      console.error("Deleting prayer failed:", error);

      setPrayerError(

        error.code === "permission-denied"

          ? "Permission denied. Check your Firestore rules."

          : "Could not delete the prayer. Please try again."

      );

    } finally {

      setDeletingPrayerId(null);

    }

  }

  // *// PUBLISH / UNPUBLISH.*

  async function togglePublished(prayer) {

    setPrayerError("");

    setNotice("");

    try {

      await updateDoc(doc(db, "prayers", prayer.id), {

        published: !prayer.published,

        updatedAt: serverTimestamp(),

      });

      setNotice(

        prayer.published

          ? `"${prayer.title}" is now a draft.`

          : `"${prayer.title}" has been published.`

      );

    } catch (error) {

      console.error("Updating publication status failed:", error);

      setPrayerError(

        error.code === "permission-denied"

          ? "You don't have permission to update this prayer. Check Firestore rules."

          : "Unable to change publication status."

      );

    }

  }

  // *// Upload audio through the existing server-side endpoint.*

  async function uploadPrayerAudio(event) {

    event.preventDefault();

    if (!selectedPrayerId) {

      setPrayerError("Select a prayer first.");

      return;

    }

    if (!audioFile) {

      setPrayerError("Choose an audio file first.");

      return;

    }

    if (

      !audioFile.type.startsWith("audio/") &&

      !/\.(m4a|aac|mp3|wav|ogg|opus|flac)$/i.test(audioFile.name)

    ) {

      setPrayerError("Please choose a valid audio file.");

      return;

    }

    if (audioFile.size > 20 * 1024 * 1024) {

      setPrayerError("The audio file must be 20 MB or smaller.");

      return;

    }

    setUploadingAudio(true);

    setPrayerError("");

    setNotice("");

    try {

      const currentUser = auth.currentUser;

      if (!currentUser) {

        throw new Error("Please sign in again.");

      }

      const firebaseToken = await currentUser.getIdToken();

      const formData = new FormData();

      formData.append("file", audioFile);

      formData.append("prayerId", selectedPrayerId);

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

      const supabaseKey =

        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      if (!supabaseUrl) {

        throw new Error("VITE_SUPABASE_URL is missing from .env.local.");

      }

      if (!supabaseKey) {

        throw new Error(

          "VITE_SUPABASE_PUBLISHABLE_KEY is missing from .env.local."

        );

      }

      const response = await fetch(

        `${supabaseUrl}/functions/v1/upload-prayer-audio`,

        {

          method: "POST",

          headers: {

            Authorization: `Bearer ${firebaseToken}`,

            apikey: supabaseKey,

          },

          body: formData,

        }

      );

      const result = await response.json();

      if (!response.ok) {

        throw new Error(result.error || "The audio upload failed.");

      }

      if (!result.path) {

        throw new Error("The upload endpoint returned no storage path.");

      }

      await updateDoc(doc(db, "prayers", selectedPrayerId), {

        audioPath: result.path,

        audioFileName: audioFile.name,

        audioContentType: audioFile.type || "audio/mpeg",

        audioUpdatedAt: serverTimestamp(),

        updatedAt: serverTimestamp(),

      });

      setAudioFile(null);

      event.target.reset();

      setNotice("Audio uploaded and linked to the prayer successfully.");

    } catch (error) {

      console.error("Audio upload failed:", error);

      setPrayerError(error.message || "Unable to upload audio.");

    } finally {

      setUploadingAudio(false);

    }

  }

  const publishedCount = prayers.filter(

    (prayer) => prayer.published === true

  ).length;

  const audioCount = prayers.filter(

    (prayer) => Boolean(prayer.audioPath)

  ).length;

  if (!authReady) {

    return <div className="loading-screen">Checking your sign-in...</div>;

  }

  if (!user) {

    return <Login onLogin={setUser} />;

  }

  return (

    <div className="admin-shell">

      <aside className="sidebar">

        <div className="brand">

          <div className="brand-icon">✝</div>

          <div>

            <strong>Smart Rosary</strong>

            <small>ADMIN CONSOLE</small>

          </div>

        </div>

        <p className="nav-label">WORKSPACE</p>

        {[

          "Overview",

          "Prayers",

          "Audio Library",

          "Kids Content",

          "Users",

          "Settings",

        ].map((tab) => (

          <button

            key={tab}

            type="button"

            className={`nav-item ${activeTab === tab ? "active" : ""}`}

            onClick={() => {

              setActiveTab(tab);

              setNotice("");

              setPrayerError("");

              setViewingPrayer(null);

            }}

          >

            <span>

              {{

                Overview: "▦",

                Prayers: "☷",

                "Audio Library": "♫",

                "Kids Content": "🧒",

                Users: "♙",

                Settings: "⚙",

              }[tab]}

            </span>

            {tab}

          </button>

        ))}

        <div className="sidebar-footer">

          <div className="avatar">SR</div>

          <div style={{ minWidth: 0 }}>

            <strong>Administrator</strong>

            <small style={{ maxWidth: 155, overflowWrap: "anywhere" }}>

              {user.email || "Signed in"}

            </small>

          </div>

        </div>

      </aside>

      <main className="main-panel">

        <header className="topbar">

          <div>

            <span className="eyebrow">SMART ROSARY / ADMIN</span>

            <h1>{activeTab}</h1>

          </div>

          <div

            style={{

              display: "flex",

              alignItems: "center",

              gap: 12,

              flexWrap: "wrap",

              justifyContent: "flex-end",

            }}

          >

            <span className="status">

              <i />

              Signed in

            </span>

            <button

              type="button"

              className="secondary-btn"

              onClick={handleSignOut}

            >

              Sign out

            </button>

          </div>

        </header>

        {signOutError && (

          <div role="alert" className="notice" style={{ color: "#b42318" }}>

            {signOutError}

          </div>

        )}

        {prayerError && (

          <div

            role="alert"

            style={{

              padding: 14,

              marginBottom: 16,

              borderRadius: 12,

              background: "#fff0f0",

              color: "#a32121",

            }}

          >

            {prayerError}

          </div>

        )}

        {notice && (

          <div

            role="status"

            style={{

              padding: 14,

              marginBottom: 16,

              borderRadius: 12,

              background: "#edf8f0",

              color: "#22663b",

            }}

          >

            {notice}

          </div>

        )}

        {activeTab === "Overview" && (

          <>

            <section className="welcome">

              <div>

                <span className="eyebrow">CONTENT MANAGEMENT</span>

                <h2>A peaceful experience starts here.</h2>

                <p>

                  Manage prayers and audio for young learners in one place.

                </p>

                <button

                  type="button"

                  className="primary-btn"

                  onClick={openNewPrayerForm}

                >

                  ＋ Add a prayer

                </button>

              </div>

              <div className="welcome-symbol">✝</div>

            </section>

            <section className="stats">

              <article className="stat-card">

                <span>Total prayers</span>

                <strong>{loadingPrayers ? "…" : prayers.length}</strong>

                <small>Stored in Firestore</small>

              </article>

              <article className="stat-card">

                <span>Published prayers</span>

                <strong>{loadingPrayers ? "…" : publishedCount}</strong>

                <small>Available for content sync</small>

              </article>

              <article className="stat-card">

                <span>Audio files</span>

                <strong>{loadingPrayers ? "…" : audioCount}</strong>

                <small>Linked to prayer records</small>

              </article>

              <article className="stat-card">

                <span>Cloud sync</span>

                <strong className="pending">

                  {loadingPrayers ? "Loading" : "Connected"}

                </strong>

                <small>Prayer database status</small>

              </article>

            </section>

            <section className="content-card">

              <div className="section-heading">

                <div>

                  <h3>Recent prayers</h3>

                  <p>Your prayer library from Firestore</p>

                </div>

                <button

                  type="button"

                  className="text-btn"

                  onClick={() => setActiveTab("Prayers")}

                >

                  View all →

                </button>

              </div>

              {loadingPrayers ? (

                <p className="notice">Loading prayers...</p>

              ) : (

                <PrayerTable

                  prayers={prayers.slice(0, 3)}

                  onViewPrayer={setViewingPrayer}

                  onEditPrayer={openEditForm}

                  onDeletePrayer={deletePrayer}

                  onTogglePublished={togglePublished}

                  deletingPrayerId={deletingPrayerId}

                />

              )}

            </section>

            {viewingPrayer && (

              <PrayerDetails

                prayer={viewingPrayer}

                onClose={() => setViewingPrayer(null)}

                onEdit={openEditForm}

              />

            )}

          </>

        )}

        {activeTab === "Prayers" && (

          <section className="content-card">

            <div className="section-heading">

              <div>

                <h3>Prayer library</h3>

                <p>Create, read, update and delete prayer content.</p>

              </div>

              <button

                type="button"

                className="primary-btn"

                onClick={() => {

                  if (showForm) {

                    resetForm();

                    setPrayerError("");

                  } else {

                    openNewPrayerForm();

                  }

                }}

              >

                {showForm ? "Close form" : "＋ Add prayer"}

              </button>

            </div>

            {showForm && (

              <form className="prayer-form" onSubmit={savePrayer}>

                <h3>

                  {editingPrayerId ? "Edit prayer" : "Create new prayer"}

                </h3>

                <label>

                  Prayer title

                  <input

                    value={formData.title}

                    onChange={(event) =>

                      updateForm("title", event.target.value)

                    }

                    required

                    maxLength={150}

                    placeholder="e.g. Sign of the Cross"

                  />

                </label>

                <label>

                  Category

                  <select

                    value={formData.category}

                    onChange={(event) =>

                      updateForm("category", event.target.value)

                    }

                  >

                    {categories.map((item) => (

                      <option key={item} value={item}>

                        {item}

                      </option>

                    ))}

                  </select>

                </label>

                <label>

                  Language

                  <select

                    value={formData.language}

                    onChange={(event) =>

                      updateForm("language", event.target.value)

                    }

                  >

                    {languages.map((item) => (

                      <option key={item} value={item}>

                        {item}

                      </option>

                    ))}

                  </select>

                </label>

                <label>

                  Prayer text

                  <textarea

                    value={formData.text}

                    onChange={(event) =>

                      updateForm("text", event.target.value)

                    }

                    placeholder="Enter the full prayer here..."

                    rows={9}

                    required

                    style={{

                      width: "100%",

                      boxSizing: "border-box",

                      resize: "vertical",

                      font: "inherit",

                      padding: 12,

                      minHeight: 180,

                    }}

                  />

                </label>

                <div className="form-actions">

                  <button

                    type="button"

                    className="secondary-btn"

                    disabled={savingPrayer}

                    onClick={() => {

                      resetForm();

                      setPrayerError("");

                    }}

                  >

                    Cancel

                  </button>

                  <button

                    type="submit"

                    className="primary-btn"

                    disabled={savingPrayer}

                  >

                    {savingPrayer

                      ? "Saving..."

                      : editingPrayerId

                        ? "Save changes"

                        : "Create prayer"}

                  </button>

                </div>

              </form>

            )}

            {viewingPrayer && (

              <PrayerDetails

                prayer={viewingPrayer}

                onClose={() => setViewingPrayer(null)}

                onEdit={openEditForm}

              />

            )}

            {loadingPrayers ? (

              <p className="notice">Loading prayers...</p>

            ) : (

              <PrayerTable

                prayers={prayers}

                onViewPrayer={setViewingPrayer}

                onEditPrayer={openEditForm}

                onDeletePrayer={deletePrayer}

                onTogglePublished={togglePublished}

                deletingPrayerId={deletingPrayerId}

              />

            )}

            <p className="notice">

              Changes are saved to Firebase Firestore and appear in the list

              automatically.

            </p>

          </section>

        )}

        {activeTab === "Audio Library" && (

          <section className="content-card">

            <div className="section-heading">

              <div>

                <h3>Audio library</h3>

                <p>Upload recordings and link them to prayers.</p>

              </div>

            </div>

            <form className="prayer-form" onSubmit={uploadPrayerAudio}>

              <label>

                Select prayer

                <select

                  value={selectedPrayerId}

                  onChange={(event) =>

                    setSelectedPrayerId(event.target.value)

                  }

                  required

                  disabled={loadingPrayers || uploadingAudio}

                >

                  <option value="">Choose a prayer...</option>

                  {prayers.map((prayer) => (

                    <option key={prayer.id} value={prayer.id}>

                      {prayer.title} — {prayer.language}

                    </option>

                  ))}

                </select>

              </label>

              <label>

                Audio file

                <input

                  type="file"

                  accept="audio/*,.m4a,.aac"

                  required

                  disabled={uploadingAudio}

                  onChange={(event) =>

                    setAudioFile(event.target.files?.[0] || null)

                  }

                />

              </label>

              {audioFile && (

                <p className="notice">

                  Selected: {audioFile.name} (

                  {(audioFile.size / (1024 * 1024)).toFixed(2)} MB)

                </p>

              )}

              <div className="form-actions">

                <button

                  type="submit"

                  className="primary-btn"

                  disabled={

                    uploadingAudio ||

                    loadingPrayers ||

                    !selectedPrayerId ||

                    !audioFile

                  }

                >

                  {uploadingAudio ? "Uploading..." : "Upload audio"}

                </button>

              </div>

            </form>

            <div className="settings-row">

              <span>Storage provider</span>

              <strong>Supabase Storage</strong>

            </div>

            <div className="settings-row">

              <span>Bucket</span>

              <strong>prayer-audio</strong>

            </div>

            <div className="settings-row">

              <span>Security</span>

              <strong>Private bucket</strong>

            </div>

            <h3>Existing audio</h3>

            {prayers.filter((prayer) => prayer.audioPath).length === 0 ? (

              <p className="notice">

                No audio has been linked to prayers yet.

              </p>

            ) : (

              <div className="table-wrap">

                <table>

                  <thead>

                    <tr>

                      <th>PRAYER</th>

                      <th>LANGUAGE</th>

                      <th>FILE</th>

                    </tr>

                  </thead>

                  <tbody>

                    {prayers

                      .filter((prayer) => prayer.audioPath)

                      .map((prayer) => (

                        <tr key={prayer.id}>

                          <td><strong>{prayer.title}</strong></td>

                          <td>{prayer.language}</td>

                          <td>{prayer.audioFileName || "Audio uploaded"}</td>

                        </tr>

                      ))}

                  </tbody>

                </table>

              </div>

            )}

          </section>

        )}

        {/* KIDS CONTENT MANAGEMENT */}

        {activeTab === "Kids Content" && <KidsContentManager />}

        {activeTab === "Users" && <UsersPanel />}

        {activeTab === "Settings" && (

          <section className="content-card">

            <h3>Portal settings</h3>

            <p>

              Signed in as {user.email || "an authenticated user"}.

            </p>

            <div className="settings-row">

              <span>Frontend</span>

              <strong>React + Vite</strong>

            </div>

            <div className="settings-row">

              <span>Authentication</span>

              <strong>Firebase Auth</strong>

            </div>

            <div className="settings-row">

              <span>Content database</span>

              <strong>Cloud Firestore</strong>

            </div>

            <div className="settings-row">

              <span>Audio storage</span>

              <strong>Supabase Storage</strong>

            </div>

          </section>

        )}

        <footer>

          Smart Rosary · Admin Portal

          <span>Built for prayer, learning and reflection.</span>

        </footer>

      </main>

    </div>

  );

}

function PrayerDetails({ prayer, onClose, onEdit }) {

  return (

    <section className="content-card" style={{ marginTop: 20 }}>

      <div className="section-heading">

        <div>

          <h3>{prayer.title}</h3>

          <p>

            {prayer.category} · {prayer.language} ·{" "}

            {prayer.published ? "Published" : "Draft"}

          </p>

        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>

          <button

            type="button"

            className="primary-btn"

            onClick={() => onEdit(prayer)}

          >

            Edit

          </button>

          <button

            type="button"

            className="secondary-btn"

            onClick={onClose}

          >

            Close

          </button>

        </div>

      </div>

      <div

        style={{

          whiteSpace: "pre-wrap",

          overflowWrap: "anywhere",

          lineHeight: 1.8,

        }}

      >

        {prayer.text ||

          "No prayer text is stored in this record yet. Edit this prayer to add it."}

      </div>

    </section>

  );

}

function PrayerTable({

  prayers,

  onViewPrayer,

  onEditPrayer,

  onDeletePrayer,

  onTogglePublished,

  deletingPrayerId,

}) {

  if (!prayers.length) {

    return (

      <p className="notice">

        No prayers yet. Add your first prayer above.

      </p>

    );

  }

  return (

    <div className="table-wrap">

      <table>

        <thead>

          <tr>

            <th>PRAYER</th>

            <th>CATEGORY</th>

            <th>LANGUAGE</th>

            <th>STATUS</th>

            <th>ACTIONS</th>

          </tr>

        </thead>

        <tbody>

          {prayers.map((prayer) => (

            <tr key={prayer.id}>

              <td><strong>{prayer.title}</strong></td>

              <td>{prayer.category}</td>

              <td>{prayer.language}</td>

              <td>

                <span

                  className={`pill ${

                    prayer.published ? "published" : "draft"

                  }`}

                >

                  {prayer.published ? "Published" : "Draft"}

                </span>

              </td>

              <td>

                <div

                  style={{

                    display: "flex",

                    gap: 8,

                    flexWrap: "wrap",

                    alignItems: "center",

                  }}

                >

                  <button

                    type="button"

                    className="text-btn"

                    onClick={() => onViewPrayer(prayer)}

                  >

                    View

                  </button>

                  <button

                    type="button"

                    className="text-btn"

                    onClick={() => onEditPrayer(prayer)}

                  >

                    Edit

                  </button>

                  <button

                    type="button"

                    className="text-btn"

                    onClick={() => onTogglePublished(prayer)}

                  >

                    {prayer.published ? "Unpublish" : "Publish"}

                  </button>

                  <button

                    type="button"

                    className="text-btn"

                    style={{ color: "#b42318" }}

                    disabled={deletingPrayerId === prayer.id}

                    onClick={() => onDeletePrayer(prayer)}

                  >

                    {deletingPrayerId === prayer.id

                      ? "Deleting..."

                      : "Delete"}

                  </button>

                </div>

              </td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>

  );

}
