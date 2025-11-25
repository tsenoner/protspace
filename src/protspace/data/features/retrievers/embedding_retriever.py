import gzip
import shutil
import time
from pathlib import Path
from typing import Optional

import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.select import Select
from selenium.common.exceptions import (
    TimeoutException,
    NoSuchElementException,
    StaleElementReferenceException,
)


def open_uniprot_website(
    headless: bool = True,
    use_webdriver_manager: bool = True,
    driver_path: Optional[str] = None,
    timeout: int = 30,
    query: Optional[str] = None,
    download_dir: Optional[str] = None,
    extract_download: bool = False,
    extract_dir: Optional[str] = None,
):
    """
    Start a Selenium Chrome session, open the UniProt website, and optionally type a query.

    Returns:
        webdriver.Chrome -- active Selenium Chrome WebDriver instance pointed at UniProt.

    Notes:
        - If `use_webdriver_manager` is True the function will attempt to use
          `webdriver_manager.chrome.ChromeDriverManager` to install a compatible driver.
        - If `use_webdriver_manager` is False, `driver_path` must be provided and point
          to a ChromeDriver executable.
        - The caller is responsible for calling `driver.quit()` when finished.
    """
    options = Options()
    if headless:
        options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-gpu")

    if use_webdriver_manager and driver_path is None:
        try:
            from webdriver_manager.chrome import ChromeDriverManager

            service = Service(ChromeDriverManager().install())
        except Exception as exc:
            raise RuntimeError(
                "webdriver_manager not available or failed to install driver. "
                "Install webdriver-manager or pass `driver_path`."
            ) from exc
    else:
        if driver_path is None:
            raise ValueError(
                "driver_path must be provided when not using webdriver_manager"
            )
        service = Service(driver_path)

    driver = webdriver.Chrome(service=service, options=options)
    driver.get("https://www.uniprot.org")

    # Wait for the page to be interactive.
    WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.TAG_NAME, "body"))
    )

    if query:
        search_box = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located(
                (By.CSS_SELECTOR, 'input[aria-label="Text query in uniprotkb"]')
            )
        )
        search_box.clear()
        search_box.send_keys(query)
        search_button = WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable(
                (By.CSS_SELECTOR, 'button.button.primary[type="submit"]')
            )
        )
        search_button.click()
        _select_table_view_if_prompted(driver, timeout=5)
        _click_download_button(driver, timeout=timeout)
        _select_embeddings_format(driver, timeout=timeout)
        _confirm_download(driver, timeout=timeout)
        _report_configuration_error(driver, timeout=5)
        job_name = _capture_file_generation_job_name(driver, timeout=5)
        if job_name:
            submitted = _submit_file_generation_job(driver, timeout=5)
            if submitted:
                _confirm_file_generation_review(driver, timeout=20)
                downloaded_path = _wait_for_file_generation_completion(
                    driver,
                    job_name,
                    max_wait_seconds=300,
                    poll_interval=5,
                    download_dir=download_dir,
                )
                if downloaded_path:
                    setattr(driver, "uniprot_download_path", downloaded_path)
                    if extract_download:
                        extracted_path = _extract_gzip_file(
                            downloaded_path,
                            target_dir=Path(extract_dir)
                            if extract_dir
                            else downloaded_path.parent,
                        )
                        setattr(driver, "uniprot_extracted_path", extracted_path)

    return driver


def _select_table_view_if_prompted(driver: webdriver.Chrome, timeout: int = 5) -> None:
    """
    Some UniProt sessions prompt the user to choose Cards or Table view
    before showing results. This helper clicks the Table radio button
    and confirms the dialog if it appears; otherwise it returns silently.
    """
    try:
        table_radio = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located(
                (By.XPATH, "//label[span[text()='Table']]/input[@name='tooltip-view']")
            )
        )
    except TimeoutException:
        return

    driver.execute_script("arguments[0].click();", table_radio)

    try:
        view_button = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located(
                (By.CSS_SELECTOR, "section.button-group button.button.primary")
            )
        )
        WebDriverWait(driver, timeout).until(
            lambda drv: view_button.is_enabled()
            and view_button.get_attribute("disabled") is None
        )
        driver.execute_script("arguments[0].click();", view_button)
    except TimeoutException:
        pass


def _click_download_button(driver: webdriver.Chrome, timeout: int = 30) -> None:
    """
    After submitting the query, click the Download button within the main toolbar.
    Returns silently if the button is not found (e.g., layout change or error state).
    """
    try:
        download_button = WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    "//div[contains(@class,'button-group')]//button[contains(., 'Download')]",
                )
            )
        )
    except TimeoutException:
        return

    driver.execute_script("arguments[0].click();", download_button)


def _select_embeddings_format(driver: webdriver.Chrome, timeout: int = 30) -> None:
    """
    Inside the download modal select the 'Embeddings' option from the format dropdown.
    Returns silently if the dropdown or option is not available.
    """
    try:
        select_el = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located((By.ID, "file-format-select"))
        )
    except TimeoutException:
        return

    try:
        Select(select_el).select_by_visible_text("Embeddings")
    except NoSuchElementException:
        pass


def _confirm_download(driver: webdriver.Chrome, timeout: int = 30) -> None:
    """
    In the sliding panel footer, click the final Download button (anchor).
    Returns silently if the button is not available.
    """
    try:
        download_anchor = WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable(
                (
                    By.CSS_SELECTOR,
                    "section.button-group.sliding-panel__button-row a.button.primary",
                )
            )
        )
    except TimeoutException:
        return

    driver.execute_script("arguments[0].click();", download_anchor)


def _report_configuration_error(driver: webdriver.Chrome, timeout: int = 5) -> None:
    """
    If UniProt displays a code block error message (e.g. unsupported parameter combo),
    print the message to the console so the user sees it immediately.
    """
    try:
        error_block = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located(
                (
                    By.XPATH,
                    "//div[contains(@class,'N_0kv')]//pre[contains(@class,'codeblock')]/code",
                )
            )
        )
    except TimeoutException:
        return

    message = error_block.text.strip()
    if message:
        print(message)


def _capture_file_generation_job_name(
    driver: webdriver.Chrome, timeout: int = 5
) -> Optional[str]:
    """
    If UniProt requires asynchronous file generation, capture the suggested job name
    so that follow-up steps can reference it.
    """
    try:
        form = WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located(
                (
                    By.CSS_SELECTOR,
                    "form[aria-label='Async download job submission form']",
                )
            )
        )
    except TimeoutException:
        return None

    job_name: Optional[str] = None
    try:
        title_input = form.find_element(By.CSS_SELECTOR, "input[name='title']")
        job_name = title_input.get_attribute("value") or title_input.get_attribute(
            "placeholder"
        )
    except NoSuchElementException:
        pass

    if job_name:
        setattr(driver, "uniprot_job_name", job_name)

    return job_name


def _submit_file_generation_job(driver: webdriver.Chrome, timeout: int = 5) -> bool:
    """
    Click the submit button within the async download job form.
    Returns True if the button was clicked, False otherwise.
    """
    try:
        submit_button = WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable(
                (
                    By.CSS_SELECTOR,
                    "form[aria-label='Async download job submission form'] button.button.primary[type='submit']",
                )
            )
        )
    except TimeoutException:
        return False

    driver.execute_script("arguments[0].click();", submit_button)
    return True


def _confirm_file_generation_review(
    driver: webdriver.Chrome, timeout: int = 20
) -> bool:
    """
    After UniProt prepares a review card, confirm it by pressing the Submit button.
    Returns True if the button was clicked, False otherwise.
    """
    try:
        review_submit = WebDriverWait(driver, timeout).until(
            EC.element_to_be_clickable(
                (
                    By.XPATH,
                    "//section[contains(@class,'card')]//h4[contains(., 'Review your file generation request')]/ancestor::section[contains(@class,'card')]//button[contains(@class,'button') and contains(@class,'primary') and @type='submit']",
                )
            )
        )
    except TimeoutException:
        return False

    driver.execute_script("arguments[0].click();", review_submit)
    return True


def _wait_for_file_generation_completion(
    driver: webdriver.Chrome,
    job_name: str,
    max_wait_seconds: int = 300,
    poll_interval: int = 5,
    download_dir: Optional[str] = None,
) -> Path:
    """
    Poll the file-generation dashboard until the target job reports Completed,
    then download the generated file via the provided link.
    """
    deadline = time.time() + max_wait_seconds

    while time.time() < deadline:
        card = _find_job_card(driver, job_name)
        if card:
            try:
                status_anchor = card.find_element(
                    By.CSS_SELECTOR, "span.dashboard__body__status a"
                )
                status_text = status_anchor.text.strip().lower()
                if status_text == "completed":
                    download_url = status_anchor.get_attribute("href")
                    if download_url:
                        return _download_generated_file(
                            download_url, job_name=job_name, download_dir=download_dir
                        )
                else:
                    print(
                        f"[UniProt] Job '{job_name}' status: {status_text.title()} – waiting..."
                    )
            except (NoSuchElementException, StaleElementReferenceException):
                pass
        else:
            print(f"[UniProt] Waiting for dashboard card of job '{job_name}'...")

        time.sleep(poll_interval)

    raise TimeoutError(
        f"File generation job '{job_name}' did not complete within {max_wait_seconds} seconds."
    )


def _find_job_card(driver: webdriver.Chrome, job_name: str):
    """
    Locate the dashboard card matching the provided job name.
    """
    cards = driver.find_elements(By.CSS_SELECTOR, "div.card__container")
    for card in cards:
        try:
            name_input = card.find_element(
                By.CSS_SELECTOR, "span.dashboard__body__name input"
            )
            value = name_input.get_attribute("value")
            if value == job_name:
                return card
        except (NoSuchElementException, StaleElementReferenceException):
            continue
    return None


def _download_generated_file(
    download_url: str,
    job_name: Optional[str] = None,
    download_dir: Optional[str] = None,
) -> Path:
    """
    Download the generated UniProt file via HTTP and return the local path.
    """
    dest_dir = Path(download_dir) if download_dir else Path.cwd()
    dest_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{job_name or 'uniprot_job'}.gz"
    dest_path = dest_dir / filename

    response = requests.get(download_url, stream=True, timeout=120)
    response.raise_for_status()

    with dest_path.open("wb") as handle:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                handle.write(chunk)

    print(f"Downloaded UniProt job '{job_name}' to {dest_path}")
    return dest_path


def _extract_gzip_file(
    source_path: Path,
    target_dir: Optional[Path] = None,
    target_suffix: str = ".h5",
) -> Path:
    """
    Extract a gzipped file to the target directory (defaults to source parent) and ensure
    the resulting file uses the desired suffix (default .h5).
    """
    target_dir = target_dir or source_path.parent
    target_dir.mkdir(parents=True, exist_ok=True)

    destination = target_dir / source_path.stem
    if target_suffix and not destination.name.endswith(target_suffix):
        destination = destination.with_suffix(target_suffix)

    with gzip.open(source_path, "rb") as src, destination.open("wb") as dst:
        shutil.copyfileobj(src, dst)

    print(f"Extracted UniProt archive to {destination}")
    return destination


if __name__ == "__main__":
    driver = open_uniprot_website(
        query="insulin AND (existence:2) AND (reviewed:true)",
        download_dir="/Users/heispv/Documents/protspace-python/protspace",
        extract_download=True,
        extract_dir="/Users/heispv/Documents/protspace-python/protspace",
    )
    print(driver.title)
    driver.quit()