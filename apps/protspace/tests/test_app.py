import os
import time

import pytest
from src.protspace.server.app import ProtSpace


def wait_for_element_attribute_to_contain(element, attribute, value, timeout=5):
    """Wait for element's attribute to contain value. Used when built-in waiters are insufficient."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        if value in element.get_attribute(attribute):
            return  # Success
        time.sleep(0.1)

    # If the loop completes without returning, the timeout was reached.
    raise TimeoutError(
        f"Timed out after {timeout}s waiting for attribute '{attribute}' of element"
        f" to contain '{value}'. Found: '{element.get_attribute(attribute)}'"
    )


@pytest.fixture
def protspace_app(dash_duo):
    """Fixture to create and start a ProtSpace app."""
    app_instance = ProtSpace()
    app = app_instance.create_app()
    dash_duo.start_server(app)
    return dash_duo


@pytest.fixture
def protspace_app_with_data(dash_duo):
    """Fixture to create and start a ProtSpace app with default data."""
    app_instance = ProtSpace(
        default_json_file="data/Pla2g2/protspace_files/Pla2g2.json"
    )
    app = app_instance.create_app()
    dash_duo.start_server(app)
    return dash_duo


def test_app_loads(protspace_app):
    """
    GIVEN the ProtSpace app
    WHEN the app is loaded
    THEN the title should be "ProtSpace"
    """
    protspace_app.wait_for_text_to_equal("h1", "ProtSpace", timeout=10)
    assert protspace_app.driver.title == "ProtSpace"


def test_select_feature_updates_graph(protspace_app_with_data):
    """
    GIVEN a ProtSpace app with default data
    WHEN a feature is selected from the dropdown
    THEN the graph should update accordingly
    """
    # Use the select_dcc_dropdown helper to select the feature
    protspace_app_with_data.select_dcc_dropdown("#feature-dropdown", value="group")

    # Wait for the graph to update by checking the legend title
    protspace_app_with_data.wait_for_text_to_equal(
        "#scatter-plot .legendtitletext", "group", timeout=4
    )


def test_help_menu_opens_and_closes(protspace_app):
    """
    GIVEN a running ProtSpace app
    WHEN the help button is clicked
    THEN the help menu should open and close
    """
    help_button = protspace_app.find_element("#help-button")
    help_menu = protspace_app.find_element("#help-menu")

    # Check that the help menu is initially hidden
    assert "display: none" in help_menu.get_attribute("style")

    # Open the help menu
    help_button.click()
    wait_for_element_attribute_to_contain(help_menu, "style", "display: inline-block")

    # Close the help menu
    help_button.click()
    wait_for_element_attribute_to_contain(help_menu, "style", "display: none")


def test_download_plot(protspace_app_with_data):
    """
    GIVEN a running ProtSpace app with data
    WHEN the download button is clicked
    THEN a plot file should be downloaded
    """
    download_button = protspace_app_with_data.find_element("#download-button")

    # Get list of files before download
    files_before = set(os.listdir(protspace_app_with_data.download_path))

    download_button.click()

    # Poll for the new file
    timeout = 15
    start_time = time.time()
    new_file = None
    while time.time() - start_time < timeout:
        files_after = set(os.listdir(protspace_app_with_data.download_path))
        newly_downloaded = files_after - files_before
        if newly_downloaded:
            new_file = newly_downloaded.pop()
            break
        time.sleep(0.5)

    assert new_file, f"No new file downloaded within {timeout}s"

    filepath = os.path.join(protspace_app_with_data.download_path, new_file)
    assert os.path.exists(filepath), "The file should exist"
    assert os.path.getsize(filepath) > 0, "The downloaded file should not be empty"
