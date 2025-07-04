import pytest
import os
from webdriver_manager.chrome import ChromeDriverManager


def pytest_configure(config):
    """Configure pytest to use webdriver-manager for ChromeDriver."""
    # Download the correct ChromeDriver version and update PATH
    driver_path = ChromeDriverManager().install()
    driver_dir = os.path.dirname(driver_path)

    # Update PATH to use the correct ChromeDriver version
    current_path = os.environ.get("PATH", "")
    os.environ["PATH"] = f"{driver_dir}:{current_path}"

    print(f"Using ChromeDriver: {driver_path}")


@pytest.fixture(scope="session")
def chrome_driver_manager():
    """Automatically manage ChromeDriver version using webdriver-manager."""
    # This will download the correct ChromeDriver version for your Chrome browser
    driver_path = ChromeDriverManager().install()
    return driver_path
