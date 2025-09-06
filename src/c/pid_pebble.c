#include <pebble.h>
#include <ctype.h>

#define MAX_LINES 10
#define MAX_LINE_LEN 64

static Window *s_window;
static MenuLayer *s_menu;
static char s_stop_label[48];
static char s_lines[MAX_LINES][MAX_LINE_LEN];
static int s_count = 0;
static bool s_loading = true;
static char s_error[64];

static bool s_font_small = false;   // nastavuje PKJS (FONT_SMALL)
static int  s_stop_index = 0;       // aktuální index (PKJS si normalizuje)

/* ---------- Helpers ---------- */
static void to_lower_ascii(char *s){ for (; *s; ++s) *s = (char)tolower((unsigned char)*s); }

static bool is_type_prefix_token(const char *tok) {
  return strcmp(tok, "tram") == 0 || strcmp(tok, "metro") == 0 || strcmp(tok, "vlak") == 0 ||
         strcmp(tok, "trolleybus") == 0 || strcmp(tok, "ferry") == 0 || strcmp(tok, "privoz") == 0;
}

static void request_departures(void) {
  DictionaryIterator *out;
  if (app_message_outbox_begin(&out) != APP_MSG_OK) return;
  dict_write_uint8(out, MESSAGE_KEY_REQUEST, 1);
  dict_write_int32(out, MESSAGE_KEY_STOP_INDEX, s_stop_index);
  app_message_outbox_send();

  s_loading = true;
  s_error[0] = '\0';
  if (s_menu) menu_layer_reload_data(s_menu);
}

/* ---------- Menu callbacks ---------- */
static uint16_t menu_num_sections(MenuLayer *menu_layer, void *context) { return 1; }

static uint16_t menu_num_rows(MenuLayer *menu_layer, uint16_t section, void *context) {
  if (s_loading) return 1;
  if (s_error[0]) return 1;
  return s_count > 0 ? s_count : 1;
}

static int16_t menu_header_height(MenuLayer *menu_layer, uint16_t section, void *context) {
  return MENU_CELL_BASIC_HEADER_HEIGHT;
}

static int16_t menu_get_cell_height(MenuLayer *menu_layer, MenuIndex *idx, void *context) {
  return s_font_small ? 44 : 52;
}

static void menu_draw_header(GContext *ctx, const Layer *cell_layer, uint16_t section, void *context) {
  menu_cell_basic_header_draw(ctx, cell_layer, s_stop_label[0] ? s_stop_label : "PID departures");
}

/* Rozdělení na title/subtitle a vykreslení vestavěným rendererem */
static void draw_two_line(GContext *ctx, const Layer *cell_layer, const char *full_in) {
  static char title_buf[40];
  static char subtitle_buf[MAX_LINE_LEN];

  char full[MAX_LINE_LEN];
  if (!full_in) full_in = "";
  snprintf(full, sizeof(full), "%s", full_in);

  char *p = full; while (*p == ' ') p++;
  char *t1 = p; while (*p && *p != ' ') p++; size_t len1 = (size_t)(p - t1); while (*p == ' ') p++;
  char *t2 = p; while (*p && *p != ' ') p++; size_t len2 = (size_t)(p - t2); while (*p == ' ') p++;

  bool join_two = false;
  if (len1 > 0 && len1 < 16) {
    char t1lc[16];
    size_t c1 = len1 < sizeof(t1lc) - 1 ? len1 : sizeof(t1lc) - 1;
    memcpy(t1lc, t1, c1); t1lc[c1] = '\0';
    to_lower_ascii(t1lc);
    if (is_type_prefix_token(t1lc) && len2 > 0) join_two = true;
  }

  if (join_two) {
    if (len1 + 1 + len2 >= sizeof(title_buf)) {
      size_t left = sizeof(title_buf) - 1;
      size_t copy1 = len1 < left ? len1 : left; memcpy(title_buf, t1, copy1); left -= copy1;
      if (left) { title_buf[copy1++] = ' '; left--; }
      size_t copy2 = len2 < left ? len2 : left; memcpy(title_buf + copy1, t2, copy2);
      title_buf[copy1 + copy2] = '\0';
    } else {
      memcpy(title_buf, t1, len1); title_buf[len1] = ' ';
      memcpy(title_buf + len1 + 1, t2, len2);
      title_buf[len1 + 1 + len2] = '\0';
    }
    snprintf(subtitle_buf, sizeof(subtitle_buf), "%s", p);
  } else {
    size_t copy1 = len1 < sizeof(title_buf) - 1 ? len1 : sizeof(title_buf) - 1;
    memcpy(title_buf, t1, copy1); title_buf[copy1] = '\0';
    const char *sub_start = (len2 > 0) ? t2 : p;
    snprintf(subtitle_buf, sizeof(subtitle_buf), "%s", sub_start);
  }

  menu_cell_basic_draw(ctx, cell_layer,
                       title_buf[0] ? title_buf : full,
                       subtitle_buf[0] ? subtitle_buf : NULL,
                       NULL);
}

static void menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *idx, void *context) {
  if (s_loading)            { menu_cell_basic_draw(ctx, cell_layer, "Loading…", NULL, NULL); return; }
  if (s_error[0])           { menu_cell_basic_draw(ctx, cell_layer, "Error", s_error, NULL); return; }
  if (s_count == 0)         { menu_cell_basic_draw(ctx, cell_layer, "No departures", NULL, NULL); return; }
  draw_two_line(ctx, cell_layer, s_lines[idx->row]);
}

/* ---------- Buttons: long UP/DOWN = přepnout zastávku ---------- */
static void long_up(ClickRecognizerRef ref, void *ctx)   { s_stop_index--; request_departures(); }
static void long_down(ClickRecognizerRef ref, void *ctx) { s_stop_index++; request_departures(); }
static void click_config_provider(void *context) {
  Window *w = (Window*)context;
  menu_layer_set_click_config_onto_window(s_menu, w);
  window_long_click_subscribe(BUTTON_ID_UP,   500, long_up,   NULL);
  window_long_click_subscribe(BUTTON_ID_DOWN, 500, long_down, NULL);
}

/* ---------- AppMessage ---------- */
static void inbox_received(DictionaryIterator *iter, void *context) {
  Tuple *t;

  t = dict_find(iter, MESSAGE_KEY_FONT_SMALL);
  if (t) { s_font_small = (t->value->int32 != 0); if (s_menu) menu_layer_reload_data(s_menu); }

  t = dict_find(iter, MESSAGE_KEY_STOP_LABEL);
  if (t) { snprintf(s_stop_label, sizeof(s_stop_label), "%s", t->value->cstring); }

  t = dict_find(iter, MESSAGE_KEY_ERROR);
  if (t) {
    snprintf(s_error, sizeof(s_error), "%s", t->value->cstring);
    s_loading = false;
    if (s_menu) menu_layer_reload_data(s_menu);
    return;
  }

  t = dict_find(iter, MESSAGE_KEY_COUNT);
  if (t) {
    s_count = t->value->int32;
    if (s_count > MAX_LINES) s_count = MAX_LINES;
    for (int i = 0; i < s_count; i++) s_lines[i][0] = '\0';
    s_loading = false;
  }

  Tuple *idx_t = dict_find(iter, MESSAGE_KEY_INDEX);
  Tuple *line_t = dict_find(iter, MESSAGE_KEY_LINE);
  if (idx_t && line_t) {
    int i = idx_t->value->int32;
    if (i >= 0 && i < MAX_LINES) snprintf(s_lines[i], sizeof(s_lines[i]), "%s", line_t->value->cstring);
  }

  if (s_menu) menu_layer_reload_data(s_menu);
}

static void inbox_dropped(AppMessageResult reason, void *context) { APP_LOG(APP_LOG_LEVEL_ERROR, "Inbox dropped: %d", reason); }
static void outbox_failed(DictionaryIterator *iter, AppMessageResult reason, void *context) { APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox failed: %d", reason); }
static void outbox_sent(DictionaryIterator *iter, void *context) { /* no-op */ }

/* ---------- Window ---------- */
static void window_load(Window *window) {
  Layer *root = window_get_root_layer(window);
  GRect b = layer_get_bounds(root);
  s_menu = menu_layer_create(b);
  menu_layer_set_callbacks(s_menu, NULL, (MenuLayerCallbacks) {
    .get_num_sections = menu_num_sections,
    .get_num_rows = menu_num_rows,
    .get_header_height = menu_header_height,
    .get_cell_height = menu_get_cell_height,
    .draw_header = menu_draw_header,
    .draw_row = menu_draw_row
  });
  layer_add_child(root, menu_layer_get_layer(s_menu));

  s_loading = true;
  menu_layer_reload_data(s_menu);
}

static void window_unload(Window *window) { menu_layer_destroy(s_menu); }

static void init(void) {
  s_window = window_create();
  window_set_window_handlers(s_window, (WindowHandlers){ .load = window_load, .unload = window_unload });
  window_stack_push(s_window, true);

  app_message_open(1024, 128);
  app_message_register_inbox_received(inbox_received);
  app_message_register_inbox_dropped(inbox_dropped);
  app_message_register_outbox_failed(outbox_failed);
  app_message_register_outbox_sent(outbox_sent);

  s_loading = true; s_stop_label[0] = '\0'; s_error[0] = '\0';
  // První REQUEST pošle PKJS po 'ready'
}

static void deinit(void) { window_destroy(s_window); }

int main(void) { init(); app_event_loop(); deinit(); }
