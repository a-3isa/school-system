// Runs on a computer: pio test -e native
#include <unity.h>
#include <sightings.h>

using namespace sightings;

void setUp() {}
void tearDown() {}

static const std::string STRAP = "DC:0D:30:AA:4A:11";

void test_keeps_the_loudest_reading_and_when_it_was_heard() {
  Window w;
  hear(w, STRAP, -80, 1000, -1);
  hear(w, STRAP, -60, 2000, -1);  // louder: replaces
  hear(w, STRAP, -70, 3000, -1);  // quieter: ignored
  TEST_ASSERT_EQUAL(1, (int)w.size());
  TEST_ASSERT_EQUAL_INT(-60, w[STRAP].rssi);
  TEST_ASSERT_EQUAL_UINT64(2000, w[STRAP].at);
}

void test_an_equally_loud_reading_does_not_move_the_time() {
  Window w;
  hear(w, STRAP, -60, 1000, -1);
  hear(w, STRAP, -60, 2000, -1);
  TEST_ASSERT_EQUAL_UINT64(1000, w[STRAP].at);
}

void test_keeps_the_last_known_battery_even_from_a_quieter_reading() {
  Window w;
  hear(w, STRAP, -60, 1000, 80);
  hear(w, STRAP, -90, 2000, 75);  // quieter, but a newer battery level
  hear(w, STRAP, -50, 3000, -1);  // louder, no battery in this frame: the level stays
  TEST_ASSERT_EQUAL_INT(75, w[STRAP].battery);
  TEST_ASSERT_EQUAL_INT(-50, w[STRAP].rssi);
}

void test_counts_each_strap_on_its_own() {
  Window w;
  hear(w, "DC:0D:30:00:00:01", -60, 1, -1);
  hear(w, "DC:0D:30:00:00:02", -70, 1, -1);
  TEST_ASSERT_EQUAL(2, (int)w.size());
}

void test_battery_percent_follows_the_two_to_three_volt_range() {
  TEST_ASSERT_EQUAL_INT(0, batteryPercent(2000));
  TEST_ASSERT_EQUAL_INT(50, batteryPercent(2500));
  TEST_ASSERT_EQUAL_INT(99, batteryPercent(2999));
  TEST_ASSERT_EQUAL_INT(100, batteryPercent(3000));
}

void test_battery_percent_stays_between_zero_and_a_hundred() {
  TEST_ASSERT_EQUAL_INT(0, batteryPercent(1));
  TEST_ASSERT_EQUAL_INT(0, batteryPercent(1500));
  TEST_ASSERT_EQUAL_INT(100, batteryPercent(3500));
  TEST_ASSERT_EQUAL_INT(100, batteryPercent(65535));
}

void test_battery_percent_is_unknown_without_a_voltage() {
  TEST_ASSERT_EQUAL_INT(-1, batteryPercent(0));
  TEST_ASSERT_EQUAL_INT(-1, batteryPercent(-5));
}

void test_only_straps_with_the_prefix_are_allowed() {
  TEST_ASSERT_TRUE(macAllowed("DC:0D:30:AA:4A:11", "DC:0D:30"));
  TEST_ASSERT_FALSE(macAllowed("AA:0D:30:AA:4A:11", "DC:0D:30"));
  TEST_ASSERT_FALSE(macAllowed("DC:0D:3", "DC:0D:30"));  // shorter than the prefix
}

void test_an_empty_prefix_allows_every_address() {
  TEST_ASSERT_TRUE(macAllowed("AA:BB:CC:DD:EE:FF", ""));
}

void test_backlog_keeps_everything_while_it_has_room() {
  Backlog b;
  Window w;
  hear(w, "A", -60, 1, -1);
  hear(w, "B", -60, 1, -1);
  addToBacklog(b, w, 5);
  addToBacklog(b, w, 5);
  TEST_ASSERT_EQUAL(4, (int)b.size());
}

void test_backlog_drops_the_oldest_when_full() {
  Backlog b;
  for (int i = 1; i <= 5; i++) {
    Window w;
    hear(w, "M" + std::to_string(i), -60, (uint64_t)i, -1);
    addToBacklog(b, w, 3);
  }
  TEST_ASSERT_EQUAL(3, (int)b.size());
  TEST_ASSERT_EQUAL_STRING("M3", b[0].first.c_str());  // M1 and M2 were the oldest
  TEST_ASSERT_EQUAL_STRING("M5", b[2].first.c_str());
}

void test_backlog_cap_applies_to_one_big_window() {
  Backlog b;
  Window w;
  for (int i = 0; i < 10; i++) hear(w, "M" + std::to_string(100 + i), -60, (uint64_t)i, -1);
  addToBacklog(b, w, 4);
  TEST_ASSERT_EQUAL(4, (int)b.size());
}

int main(int, char**) {
  UNITY_BEGIN();
  RUN_TEST(test_keeps_the_loudest_reading_and_when_it_was_heard);
  RUN_TEST(test_an_equally_loud_reading_does_not_move_the_time);
  RUN_TEST(test_keeps_the_last_known_battery_even_from_a_quieter_reading);
  RUN_TEST(test_counts_each_strap_on_its_own);
  RUN_TEST(test_battery_percent_follows_the_two_to_three_volt_range);
  RUN_TEST(test_battery_percent_stays_between_zero_and_a_hundred);
  RUN_TEST(test_battery_percent_is_unknown_without_a_voltage);
  RUN_TEST(test_only_straps_with_the_prefix_are_allowed);
  RUN_TEST(test_an_empty_prefix_allows_every_address);
  RUN_TEST(test_backlog_keeps_everything_while_it_has_room);
  RUN_TEST(test_backlog_drops_the_oldest_when_full);
  RUN_TEST(test_backlog_cap_applies_to_one_big_window);
  return UNITY_END();
}
